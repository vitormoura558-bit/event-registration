const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

// Uso: node scripts/create_admin.js <username> <password> [db_path]
const argv = process.argv.slice(2);
if (argv.length < 2) {
  console.log('Uso: node scripts/create_admin.js <username> <password> [db_path]');
  process.exit(1);
}

const username = argv[0];
const password = argv[1];
const dbPath = argv[2] || path.join(__dirname, '..', 'db.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erro ao abrir DB:', err.message);
    process.exit(1);
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    role TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  const hash = bcrypt.hashSync(password, 10);

  db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
    if (err) {
      console.error('Erro consultando usuário:', err.message);
      process.exit(1);
    }

    if (row) {
      db.run('UPDATE users SET password_hash = ?, role = ? WHERE id = ?', [hash, 'admin', row.id], function (uerr) {
        if (uerr) console.error('Erro atualizando usuário:', uerr.message);
        else console.log(`Usuário '${username}' atualizado como admin (id=${row.id}).`);
        db.close();
      });
    } else {
      db.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username, hash, 'admin'], function (ierr) {
        if (ierr) console.error('Erro inserindo usuário:', ierr.message);
        else console.log(`Usuário '${username}' criado como admin (id=${this.lastID}).`);
        db.close();
      });
    }
  });
});
