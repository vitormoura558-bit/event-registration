const express = require('express');
const MP = require('mercadopago');
const bcrypt = require('bcryptjs');
const MercadoPagoConfig = MP.default || MP.MercadoPagoConfig;
const mpConfig = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN || '' });
const mpPreference = new MP.Preference(mpConfig);
const publicRouter = express.Router();
const DEFAULT_EVENT_PRICE = parseFloat(process.env.EVENT_PRICE || '50.00');

publicRouter.get('/login', (req, res) => {
  res.render('login', { error: null });
});

publicRouter.get('/leader/login', (req, res) => {
  res.render('leader_login', { error: null });
});

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
  db.get('SELECT id, link_name FROM leaders WHERE link_name = ?', [link_name], (err, leader) => {
    if (err) return res.status(500).send('Erro no banco de dados');

    db.get('SELECT value FROM settings WHERE key = ?', ['leader_password_hash'], (settingsErr, setting) => {
      if (settingsErr) return res.status(500).send('Erro no banco de dados');

      const passwordHash = setting && setting.value;
      if (!leader || !passwordHash || !bcrypt.compareSync(password, passwordHash)) {
        return res.status(401).render('leader_login', { error: 'Grupo ou senha inválidos' });
      }

      req.session.leader = { id: leader.id, link_name: leader.link_name };
      return res.redirect(`/painel/lider/${leader.id}`);
    });
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

    const normalizedPaymentStatus =
      payment_method === 'MercadoPago' || payment_method === 'MP'
        ? 'AWAITING_PAYMENT'
        : payment_date ? 'REPORTED' : 'PENDING';

    db.run(`INSERT INTO inscriptions (name, age, phone, link_name, leader_id, payment_method, payment_date, payment_status, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDENTE')`,
      [name, age, phone, link_name, leader.id, payment_method, payment_date, normalizedPaymentStatus], function (err) {
        if (err) console.error(err.message);
        const inscriptionId = this.lastID;

        const provider = payment_method === 'MercadoPago' || payment_method === 'MP' ? 'MERCADO_PAGO' : 'MANUAL';
        const paymentAmount = Number.isFinite(DEFAULT_EVENT_PRICE) ? DEFAULT_EVENT_PRICE : null;

        db.run(
          `INSERT INTO payments (inscription_id, provider, method, amount, status, external_reference, paid_at, payload, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [
            inscriptionId,
            provider,
            payment_method,
            paymentAmount,
            normalizedPaymentStatus,
            String(inscriptionId),
            null,
            JSON.stringify({ payment_date: payment_date || null })
          ],
          (paymentErr) => {
            if (paymentErr) console.error('Erro criando registro de pagamento:', paymentErr.message);
          }
        );

        if (payment_method === 'MercadoPago' || payment_method === 'MP') {
          const preference = {
            items: [{ title: `Inscrição #${inscriptionId}`, quantity: 1, unit_price: DEFAULT_EVENT_PRICE }],
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
              db.run(
                `UPDATE payments
                 SET provider_preference_id = ?, payload = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE inscription_id = ?`,
                [String(prefId), JSON.stringify(response), inscriptionId],
                (paymentUpdateErr) => {
                  if (paymentUpdateErr) console.error('Erro atualizando pagamento MP:', paymentUpdateErr.message);
                  res.render('confirm', {
                    leader_whatsapp: leader.whatsapp,
                    inscription_id: inscriptionId,
                    mp_link: initPoint,
                    payment_method: payment_method,
                    payment_status: normalizedPaymentStatus
                  });
                }
              );
            });
          }).catch(err => {
            console.error('Erro criando preferência MP:', err);
            db.run(
              `UPDATE payments
               SET status = 'ERROR', payload = ?, updated_at = CURRENT_TIMESTAMP
               WHERE inscription_id = ?`,
              [JSON.stringify({ error: err.message || String(err) }), inscriptionId],
              (paymentUpdateErr) => {
                if (paymentUpdateErr) console.error('Erro marcando falha do pagamento MP:', paymentUpdateErr.message);
                db.run('UPDATE inscriptions SET payment_status = ? WHERE id = ?', ['ERROR', inscriptionId], () => {
                  res.render('confirm', {
                    leader_whatsapp: leader.whatsapp,
                    inscription_id: inscriptionId,
                    payment_method: payment_method,
                    payment_status: 'ERROR'
                  });
                });
              }
            );
          });
        } else {
          res.render('confirm', {
            leader_whatsapp: leader.whatsapp,
            inscription_id: inscriptionId,
            payment_method: payment_method,
            payment_status: normalizedPaymentStatus
          });
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
