const express = require('express');
const bcrypt = require('bcryptjs');
const { protectAdmin } = require('../middleware/auth');
const adminRouter = express.Router();

adminRouter.use('/painel/admin', protectAdmin);

// Painel admin geral
adminRouter.get('/painel/admin', (req, res) => {
  const db = req.db;
  db.all('SELECT i.*, l.name AS leader_name FROM inscriptions i LEFT JOIN leaders l ON i.leader_id = l.id ORDER BY created_at DESC', [], (err, rows) => {
    if (err) {
      console.error(err.message);
      return res.status(500).send('Erro no banco de dados');
    }

    db.get('SELECT COUNT(*) AS total FROM leaders', [], (leadersErr, leadersRow) => {
      if (leadersErr) {
        console.error(leadersErr.message);
        return res.status(500).send('Erro no banco de dados');
      }

      db.all(`
        SELECT l.id, l.name, l.whatsapp, l.link_name, COUNT(i.id) AS inscription_count
        FROM leaders l
        LEFT JOIN inscriptions i ON i.leader_id = l.id
        GROUP BY l.id, l.name, l.whatsapp, l.link_name
        ORDER BY l.name ASC
      `, [], (listErr, leaders) => {
        if (listErr) {
          console.error(listErr.message);
          return res.status(500).send('Erro no banco de dados');
        }

        db.get('SELECT value FROM settings WHERE key = ?', ['leader_password_hash'], (settingsErr, setting) => {
        if (settingsErr) {
          console.error(settingsErr.message);
          return res.status(500).send('Erro no banco de dados');
        }

        res.render('painel_admin', {
          inscriptions: rows,
          leaders,
          leaderCount: leadersRow ? leadersRow.total : 0,
          leaderPasswordConfigured: Boolean(setting && setting.value),
          passwordMessage: req.query.password === 'updated' ? 'Senha global dos líderes atualizada com sucesso.' : null,
          passwordError: req.query.password === 'empty' ? 'Informe uma senha válida para os líderes.' : null,
          leaderMessage:
            req.query.leader === 'created' ? 'Líder cadastrado com sucesso.' :
            req.query.leader === 'updated' ? 'Líder atualizado com sucesso.' :
            req.query.leader === 'deleted' ? 'Líder removido com sucesso.' : null,
          leaderError:
            req.query.leader === 'invalid' ? 'Preencha nome, WhatsApp e link do líder.' :
            req.query.leader === 'exists' ? 'Já existe um líder com esse link.' :
            req.query.leader === 'linked' ? 'Esse líder possui inscrições vinculadas e não pode ser removido.' :
            req.query.leader === 'notfound' ? 'Líder não encontrado.' : null
        });
        });
      });
    });
  });
});

adminRouter.post('/painel/admin/leader-password', (req, res) => {
  const db = req.db;
  const password = (req.body.leader_password || '').trim();

  if (!password) {
    return res.redirect('/painel/admin?password=empty');
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  db.run(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ['leader_password_hash', passwordHash],
    (err) => {
      if (err) {
        console.error(err.message);
        return res.status(500).send('Erro ao atualizar senha dos líderes');
      }

      return res.redirect('/painel/admin?password=updated');
    }
  );
});

adminRouter.post('/painel/admin/leaders', (req, res) => {
  const db = req.db;
  const name = (req.body.name || '').trim();
  const whatsapp = (req.body.whatsapp || '').trim();
  const linkName = (req.body.link_name || '').trim().toLowerCase();

  if (!name || !whatsapp || !linkName) {
    return res.redirect('/painel/admin?leader=invalid');
  }

  db.get('SELECT id FROM leaders WHERE link_name = ?', [linkName], (err, existingLeader) => {
    if (err) {
      console.error(err.message);
      return res.status(500).send('Erro no banco de dados');
    }

    if (existingLeader) {
      return res.redirect('/painel/admin?leader=exists');
    }

    db.run(
      'INSERT INTO leaders (name, whatsapp, link_name) VALUES (?, ?, ?)',
      [name, whatsapp, linkName],
      (insertErr) => {
        if (insertErr) {
          console.error(insertErr.message);
          return res.status(500).send('Erro ao cadastrar líder');
        }

        return res.redirect('/painel/admin?leader=created');
      }
    );
  });
});

adminRouter.post('/painel/admin/leaders/:id/update', (req, res) => {
  const db = req.db;
  const leaderId = req.params.id;
  const name = (req.body.name || '').trim();
  const whatsapp = (req.body.whatsapp || '').trim();
  const linkName = (req.body.link_name || '').trim().toLowerCase();

  if (!name || !whatsapp || !linkName) {
    return res.redirect('/painel/admin?leader=invalid');
  }

  db.get('SELECT id FROM leaders WHERE id = ?', [leaderId], (err, leader) => {
    if (err) {
      console.error(err.message);
      return res.status(500).send('Erro no banco de dados');
    }

    if (!leader) {
      return res.redirect('/painel/admin?leader=notfound');
    }

    db.get('SELECT id FROM leaders WHERE link_name = ? AND id <> ?', [linkName, leaderId], (existsErr, existingLeader) => {
      if (existsErr) {
        console.error(existsErr.message);
        return res.status(500).send('Erro no banco de dados');
      }

      if (existingLeader) {
        return res.redirect('/painel/admin?leader=exists');
      }

      db.run(
        'UPDATE leaders SET name = ?, whatsapp = ?, link_name = ? WHERE id = ?',
        [name, whatsapp, linkName, leaderId],
        (updateErr) => {
          if (updateErr) {
            console.error(updateErr.message);
            return res.status(500).send('Erro ao atualizar líder');
          }

          return res.redirect('/painel/admin?leader=updated');
        }
      );
    });
  });
});

adminRouter.post('/painel/admin/leaders/:id/delete', (req, res) => {
  const db = req.db;
  const leaderId = req.params.id;

  db.get('SELECT id FROM leaders WHERE id = ?', [leaderId], (err, leader) => {
    if (err) {
      console.error(err.message);
      return res.status(500).send('Erro no banco de dados');
    }

    if (!leader) {
      return res.redirect('/painel/admin?leader=notfound');
    }

    db.get('SELECT COUNT(*) AS total FROM inscriptions WHERE leader_id = ?', [leaderId], (countErr, countRow) => {
      if (countErr) {
        console.error(countErr.message);
        return res.status(500).send('Erro no banco de dados');
      }

      if (countRow && countRow.total > 0) {
        return res.redirect('/painel/admin?leader=linked');
      }

      db.run('DELETE FROM leaders WHERE id = ?', [leaderId], (deleteErr) => {
        if (deleteErr) {
          console.error(deleteErr.message);
          return res.status(500).send('Erro ao remover líder');
        }

        return res.redirect('/painel/admin?leader=deleted');
      });
    });
  });
});

module.exports = adminRouter;
