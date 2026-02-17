const express = require('express');
const { protectAdmin } = require('../middleware/auth');
const adminRouter = express.Router();

adminRouter.use(protectAdmin);

// Painel admin geral
adminRouter.get('/painel/admin', (req, res) => {
  const db = req.db;
  db.all('SELECT i.*, l.name AS leader_name FROM inscriptions i LEFT JOIN leaders l ON i.leader_id = l.id ORDER BY created_at DESC', [], (err, rows) => {
    if (err) console.error(err.message);
    res.render('painel_admin', { inscriptions: rows });
  });
});

module.exports = adminRouter;