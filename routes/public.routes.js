const express = require('express');
const MP = require('mercadopago');
const bcrypt = require('bcryptjs');
const MercadoPagoConfig = MP.default || MP.MercadoPagoConfig;
const mpConfig = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN || '' });
const mpPreference = new MP.Preference(mpConfig);
const publicRouter = express.Router();

// Login admin
publicRouter.post('/login', (req, res) => {
  const db = req.db;
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) return res.status(500).send('Erro no banco de dados');
    if (!user) return res.status(401).render('login', { error: 'Usuário ou senha inválidos' });
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).render('login', { error: 'Usuário ou senha inválidos' });
    }
    req.session.user = { id: user.id, username: user.username, role: user.role };
    return res.redirect('/painel/admin');
  });
});

// Login líder
publicRouter.post('/leader/login', (req, res) => {
  const db = req.db;
  const { link_name, password } = req.body;
  db.get('SELECT * FROM leaders WHERE link_name = ?', [link_name], (err, leader) => {
    if (err) return res.status(500).send('Erro no banco de dados');
    if (!leader) return res.status(401).render('leader_login', { error: 'Grupo não encontrado' });
    // Senha global de líder
    const leaderPass = process.env.LEADER_PASSWORD || 'leaderpass';
    if (password !== leaderPass) {
      return res.status(401).render('leader_login', { error: 'Senha do líder inválida' });
    }
    req.session.leader = { id: leader.id, link_name: leader.link_name };
    return res.redirect(`/painel/lider/${leader.id}`);
  });
});

// Página pública: redireciona para inscrição
publicRouter.get('/', (req, res) => res.redirect('/inscrever'));

// Formulário
publicRouter.get('/inscrever', (req, res) => {
  const db = req.db;
  db.all('SELECT * FROM leaders', [], (err, leaders) => {
    if (err) console.error(err.message);
    res.render('form', { leaders });
  });
});

// Submissão
publicRouter.post('/inscrever', (req, res) => {
  const db = req.db;
  const { name, age, phone, link_name, payment_method, payment_date } = req.body;

  db.get('SELECT id, whatsapp FROM leaders WHERE link_name = ?', [link_name], (err, leader) => {
    if (err) console.error(err.message);
    if (!leader) return res.send('Líder não encontrado.');

    db.run(`INSERT INTO inscriptions (name, age, phone, link_name, leader_id, payment_method, payment_date, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDENTE')`,
      [name, age, phone, link_name, leader.id, payment_method, payment_date], function (err) {
        if (err) console.error(err.message);
        const inscriptionId = this.lastID;

        if (payment_method === 'MercadoPago' || payment_method === 'MP') {
          const price = parseFloat(process.env.EVENT_PRICE || '50.00');
          const preference = {
            items: [{ title: `Inscrição #${inscriptionId}`, quantity: 1, unit_price: price }],
            external_reference: String(inscriptionId),
            back_urls: {
              success: `${req.protocol}://${req.get('host')}/acompanhamento/${inscriptionId}`,
              failure: `${req.protocol}://${req.get('host')}/acompanhamento/${inscriptionId}`,
              pending: `${req.protocol}://${req.get('host')}/acompanhamento/${inscriptionId}`
            },
            auto_return: 'approved'
          };

          mpPreference.create({ body: preference }).then(response => {
            const initPoint = response.init_point || response.sandbox_init_point || response.init_point_url;
            const prefId = response.id;
            db.run('UPDATE inscriptions SET mp_preference_id = ? WHERE id = ?', [String(prefId), inscriptionId], (err) => {
              if (err) console.error(err.message);
              res.render('confirm', { leader_whatsapp: leader.whatsapp, inscription_id: inscriptionId, mp_link: initPoint });
            });
          }).catch(err => {
            console.error('Erro criando preferência MP:', err);
            res.render('confirm', { leader_whatsapp: leader.whatsapp, inscription_id: inscriptionId });
          });
        } else {
          res.render('confirm', { leader_whatsapp: leader.whatsapp, inscription_id: inscriptionId });
        }
      });
  });
});

// Acompanhamento
publicRouter.get('/acompanhamento/:id', (req, res) => {
  const db = req.db;
  const id = req.params.id;
  db.get('SELECT i.*, l.name AS leader_name FROM inscriptions i LEFT JOIN leaders l ON i.leader_id = l.id WHERE i.id = ?', [id], (err, row) => {
    if (err) console.error(err.message);
    if (!row) return res.send('Inscrição não encontrada.');
    res.render('acompanhamento', { inscription: row });
  });
});

module.exports = publicRouter;