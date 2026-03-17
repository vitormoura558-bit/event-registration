const bcrypt = require('bcryptjs');
const request = require('supertest');
const { createTestContext, destroyTestContext, getDbHelpers, waitForDatabaseReady } = require('./helpers/db');

describe('HTTP flow', () => {
  let context;
  let db;

  beforeEach(async () => {
    context = createTestContext();
    db = getDbHelpers(context.db);
    await waitForDatabaseReady(context.db);
  });

  afterEach(async () => {
    await destroyTestContext(context);
  });

  test('GET login pages render successfully', async () => {
    await request(context.app).get('/login').expect(200);
    await request(context.app).get('/leader/login').expect(200);
  });

  test('POST /inscrever with PIX creates inscription and manual payment record', async () => {
    await db.run(
      'INSERT INTO leaders (name, whatsapp, link_name) VALUES (?, ?, ?)',
      ['Lider Teste', '5511999999999', 'grupo-teste']
    );

    const response = await request(context.app)
      .post('/inscrever')
      .type('form')
      .send({
        name: 'Pessoa Teste',
        age: 22,
        phone: '11999999999',
        link_name: 'grupo-teste',
        payment_method: 'PIX',
        payment_date: '2026-03-17'
      })
      .expect(200);

    expect(response.text).toContain('Inscrição Recebida');

    const inscription = await db.get('SELECT * FROM inscriptions WHERE name = ?', ['Pessoa Teste']);
    const payment = await db.get('SELECT * FROM payments WHERE inscription_id = ?', [inscription.id]);

    expect(inscription.status).toBe('PENDENTE');
    expect(inscription.payment_status).toBe('REPORTED');
    expect(payment.provider).toBe('MANUAL');
    expect(payment.method).toBe('PIX');
    expect(payment.status).toBe('REPORTED');
  });

  test('leader can authenticate and confirm manual payment', async () => {
    const leaderPasswordHash = bcrypt.hashSync('senha-global', 10);

    const leaderInsert = await db.run(
      'INSERT INTO leaders (name, whatsapp, link_name) VALUES (?, ?, ?)',
      ['Lider Teste', '5511999999999', 'grupo-lider']
    );
    const leaderId = leaderInsert.lastID;

    await db.run(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)`,
      ['leader_password_hash', leaderPasswordHash]
    );

    const inscriptionInsert = await db.run(
      `INSERT INTO inscriptions (name, age, phone, link_name, leader_id, payment_method, payment_date, payment_status, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['Pessoa Manual', 20, '11999999999', 'grupo-lider', leaderId, 'PIX', '2026-03-17', 'REPORTED', 'PENDENTE']
    );
    const inscriptionId = inscriptionInsert.lastID;

    await db.run(
      `INSERT INTO payments (inscription_id, provider, method, amount, status, external_reference, payload, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [inscriptionId, 'MANUAL', 'PIX', 50, 'REPORTED', String(inscriptionId), '{}']
    );

    const agent = request.agent(context.app);

    await agent
      .post('/leader/login')
      .type('form')
      .send({ link_name: 'grupo-lider', password: 'senha-global' })
      .expect(302);

    await agent
      .post(`/painel/lider/${leaderId}/confirmar/${inscriptionId}`)
      .type('form')
      .send({})
      .expect(302);

    const inscription = await db.get('SELECT * FROM inscriptions WHERE id = ?', [inscriptionId]);
    const payment = await db.get('SELECT * FROM payments WHERE inscription_id = ?', [inscriptionId]);

    expect(inscription.status).toBe('CONFIRMADO');
    expect(inscription.payment_status).toBe('PAID');
    expect(inscription.paid_at).toBeTruthy();
    expect(payment.status).toBe('PAID');
    expect(payment.paid_at).toBeTruthy();
  });
});
