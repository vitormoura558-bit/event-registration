const express = require('express');
const { protectLeader } = require('../middleware/auth');
const leaderRouter = express.Router();

// Aplica proteção apenas nas rotas do painel do líder
leaderRouter.use('/painel/lider', protectLeader);

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

    const paidAt = new Date().toISOString();
    db.run("UPDATE inscriptions SET status = 'CONFIRMADO', payment_status = 'PAID', paid_at = COALESCE(paid_at, ?) WHERE id = ?", [paidAt, inscriptionId], function (err) {
      if (err) {
        console.error(err.message);
        return res.status(500).send('Erro ao confirmar');
      }

      db.run(
        `UPDATE payments
         SET status = 'PAID', paid_at = COALESCE(paid_at, ?), updated_at = CURRENT_TIMESTAMP
         WHERE inscription_id = ?`,
        [paidAt, inscriptionId],
        (paymentErr) => {
          if (paymentErr) {
            console.error(paymentErr.message);
            return res.status(500).send('Erro ao confirmar pagamento');
          }

          res.redirect(req.get('Referrer') || '/');
        }
      );
    });
  });
});

module.exports = leaderRouter;
