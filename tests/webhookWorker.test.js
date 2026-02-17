const sqlite3 = require('sqlite3').verbose();
const { processPendingOnce } = require('../lib/webhookWorker');
const util = require('util');

function runSql(db, sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function (err) {
    if (err) return reject(err);
    resolve(this);
  }));
}

function getSql(db, sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (err, row) => {
    if (err) return reject(err);
    resolve(row);
  }));
}

function allSql(db, sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => {
    if (err) return reject(err);
    resolve(rows);
  }));
}

describe('webhookWorker', () => {
  let db;
  beforeEach(async () => {
    db = new sqlite3.Database(':memory:');
    await runSql(db, `CREATE TABLE leaders (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, whatsapp TEXT, link_name TEXT)`);
    await runSql(db, `CREATE TABLE inscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, age INTEGER, phone TEXT, link_name TEXT, leader_id INTEGER, mp_preference_id TEXT, mp_payment_id TEXT, payment_method TEXT, payment_date TEXT, status TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await runSql(db, `CREATE TABLE webhook_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id TEXT, payload TEXT, received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, processed INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, processed_at TIMESTAMP, result_status TEXT)`);

    // criar inscrição com id 1
    await runSql(db, `INSERT INTO inscriptions (id, name, status) VALUES (?, ?, ?)`, [1, 'Test User', 'PENDENTE']);
  });

  afterEach(() => {
    db.close();
  });

  test('processPendingOnce confirma inscrição quando pagamento aprovado', async () => {
    // enfileirar webhook com payment_id = '123'
    await runSql(db, `INSERT INTO webhook_queue (payment_id, payload) VALUES (?, ?)`, ['123', JSON.stringify({})]);

    // mock mpClient
    const mpClient = {
      get: async ({ id }) => {
        expect(id).toBe('123');
        return { external_reference: '1', status: 'approved' };
      }
    };

    await processPendingOnce(db, mpClient);

    const inscription = await getSql(db, `SELECT * FROM inscriptions WHERE id = ?`, [1]);
    expect(inscription.status).toBe('CONFIRMADO');

    const queueRow = await getSql(db, `SELECT * FROM webhook_queue WHERE payment_id = ?`, ['123']);
    expect(queueRow.processed).toBe(1);
    expect(queueRow.result_status).toBe('confirmed');
  });

  test('processPendingOnce atualiza status quando payment diferente de approved', async () => {
    await runSql(db, `INSERT INTO webhook_queue (payment_id, payload) VALUES (?, ?)`, ['456', JSON.stringify({})]);

    const mpClient = {
      get: async ({ id }) => {
        expect(id).toBe('456');
        return { external_reference: '1', status: 'pending' };
      }
    };

    await processPendingOnce(db, mpClient);

    const inscription = await getSql(db, `SELECT * FROM inscriptions WHERE id = ?`, [1]);
    expect(inscription.status).toBe('PENDING');

    const queueRow = await getSql(db, `SELECT * FROM webhook_queue WHERE payment_id = ?`, ['456']);
    expect(queueRow.processed).toBe(1);
    expect(queueRow.result_status).toBe('pending');
  });
});
