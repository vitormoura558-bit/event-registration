const request = require('supertest');
const nock = require('nock');
const crypto = require('crypto');
const { createApp } = require('../server');

const { app, db, processPendingOnce } = createApp({ dbPath: ':memory:', startWorker: false });

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

describe('HTTP webhook + worker integration', () => {
  beforeAll(async () => {
    // ensure tables exist
    await runSql(db, `CREATE TABLE IF NOT EXISTS inscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, status TEXT, mp_payment_id TEXT, payment_date TEXT)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS webhook_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id TEXT, payload TEXT, received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, processed INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, processed_at TIMESTAMP, result_status TEXT)`);

    // create inscription id=1
    await runSql(db, `INSERT OR REPLACE INTO inscriptions (id, name, status) VALUES (?, ?, ?)`, [1, 'HTTP Test User', 'PENDENTE']);
  });

  afterAll(() => {
    nock.cleanAll();
    db.close();
  });

  test('POST /mp/webhook enfileira e worker processa com mock MP', async () => {
    const paymentId = 'pay_abc123';

    // preparar nock para interceptar a chamada do worker ao MP
    const mpScope = nock('https://api.mercadopago.test')
      .get(`/v1/payments/${paymentId}`)
      .reply(200, { external_reference: '1', status: 'approved' });

    // preparar body e assinatura
    const body = { data: { id: paymentId } };
    const secret = process.env.MP_WEBHOOK_SECRET || 'test_secret';
    const raw = Buffer.from(JSON.stringify(body));
    const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');

    // enviar webhook (usar header de assinatura que server espera)
    const res = await request(app)
      .post('/mp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-mp-signature', signature)
      .send(body);

    expect(res.status).toBe(200);

    // agora rodar worker manualmente, com mpClient que faz HTTP GET (capturado por nock)
    const mpClient = {
      get: ({ id }) => {
        return new Promise((resolve, reject) => {
          const https = require('https');
          const url = `https://api.mercadopago.test/v1/payments/${id}`;
          https.get(url, (resp) => {
            let data = '';
            resp.on('data', (chunk) => data += chunk);
            resp.on('end', () => resolve(JSON.parse(data)));
          }).on('error', reject);
        });
      }
    };

    await processPendingOnce(db, mpClient);

    // verificar inscrição confirmada
    const inscription = await getSql(db, `SELECT * FROM inscriptions WHERE id = ?`, [1]);
    expect(inscription.status).toBe('CONFIRMADO');
    expect(mpScope.isDone()).toBe(true);
  });
});
