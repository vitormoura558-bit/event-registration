const express = require('express');
const { protectLeader } = require('../middleware/auth');
const leaderRouter = express.Router();

// Aplica proteção de líder a todas as rotas deste roteador
leaderRouter.use(protectLeader);

// Painel do líder
leaderRouter.get('/painel/lider/:id', (req, res) => {
  const db = req.db;
  const leaderId = req.params.id;
  // Verifica se o líder logado é o dono do painel
  if (req.session.leader.id != leaderId) {
    return res.status(403).send('Acesso negado a este painel.');
  }
  db.all('SELECT * FROM inscriptions WHERE leader_id = ? ORDER BY created_at DESC', [leaderId], (err, rows) => {
    if (err) console.error(err.message);
    res.render('painel_lider', { inscriptions: rows });
  });
});

// Confirmar inscrição
leaderRouter.post('/painel/lider/:id/confirmar/:inscriptionId', (req, res) => {
  const db = req.db;
  const leaderId = req.params.id;
  const inscriptionId = req.params.inscriptionId;

  // Verifica se a inscrição pertence ao líder
  db.get('SELECT leader_id FROM inscriptions WHERE id = ?', [inscriptionId], (err, row) => {
    if (err) {
      console.error(err.message);
      return res.status(500).send('Erro no banco de dados');
    }
    if (!row) return res.status(404).send('Inscrição não encontrada');
    if (row.leader_id != leaderId) {
      return res.status(403).send('Você não tem permissão para confirmar esta inscrição');
    }

    db.run("UPDATE inscriptions SET status = 'CONFIRMADO' WHERE id = ?", [inscriptionId], function (err) {
      if (err) {
        console.error(err.message);
        return res.status(500).send('Erro ao confirmar');
      }
      res.redirect(req.get('Referrer') || '/');
    });
  });
});

module.exports = leaderRouter;