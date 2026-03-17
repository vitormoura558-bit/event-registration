const { processPendingOnce } = require('../lib/webhookWorker');
const { createTestContext, destroyTestContext, getDbHelpers, waitForDatabaseReady } = require('./helpers/db');

describe('webhook worker', () => {
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

  test('marks Mercado Pago payment as paid and confirms inscription', async () => {
    const inscriptionInsert = await db.run(
      `INSERT INTO inscriptions (name, phone, link_name, leader_id, payment_method, payment_status, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Pessoa MP', '11999999999', 'grupo-mp', 1, 'MercadoPago', 'AWAITING_PAYMENT', 'PENDENTE']
    );
    const inscriptionId = inscriptionInsert.lastID;

    await db.run(
      `INSERT INTO payments (inscription_id, provider, method, amount, status, external_reference, provider_preference_id, payload, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [inscriptionId, 'MERCADO_PAGO', 'MercadoPago', 50, 'AWAITING_PAYMENT', String(inscriptionId), 'pref-123', '{}']
    );

    await db.run(
      'INSERT INTO webhook_queue (payment_id, payload) VALUES (?, ?)',
      ['pay-123', JSON.stringify({ data: { id: 'pay-123' } })]
    );

    const mpClient = {
      get: jest.fn().mockResolvedValue({
        id: 'pay-123',
        external_reference: String(inscriptionId),
        status: 'approved'
      })
    };

    await processPendingOnce(context.db, mpClient);

    const inscription = await db.get('SELECT * FROM inscriptions WHERE id = ?', [inscriptionId]);
    const payment = await db.get('SELECT * FROM payments WHERE inscription_id = ?', [inscriptionId]);
    const queue = await db.get('SELECT * FROM webhook_queue WHERE payment_id = ?', ['pay-123']);

    expect(inscription.status).toBe('CONFIRMADO');
    expect(inscription.payment_status).toBe('PAID');
    expect(payment.status).toBe('PAID');
    expect(payment.provider_reference_id).toBe('pay-123');
    expect(queue.processed).toBe(1);
    expect(queue.result_status).toBe('confirmed');
  });

  test('updates payment status without confirming inscription when payment is pending', async () => {
    const inscriptionInsert = await db.run(
      `INSERT INTO inscriptions (name, phone, link_name, leader_id, payment_method, payment_status, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Pessoa MP Pendente', '11999999999', 'grupo-mp', 1, 'MercadoPago', 'AWAITING_PAYMENT', 'PENDENTE']
    );
    const inscriptionId = inscriptionInsert.lastID;

    await db.run(
      `INSERT INTO payments (inscription_id, provider, method, amount, status, external_reference, payload, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [inscriptionId, 'MERCADO_PAGO', 'MercadoPago', 50, 'AWAITING_PAYMENT', String(inscriptionId), '{}']
    );

    await db.run(
      'INSERT INTO webhook_queue (payment_id, payload) VALUES (?, ?)',
      ['pay-456', JSON.stringify({ data: { id: 'pay-456' } })]
    );

    const mpClient = {
      get: jest.fn().mockResolvedValue({
        id: 'pay-456',
        external_reference: String(inscriptionId),
        status: 'pending'
      })
    };

    await processPendingOnce(context.db, mpClient);

    const inscription = await db.get('SELECT * FROM inscriptions WHERE id = ?', [inscriptionId]);
    const payment = await db.get('SELECT * FROM payments WHERE inscription_id = ?', [inscriptionId]);
    const queue = await db.get('SELECT * FROM webhook_queue WHERE payment_id = ?', ['pay-456']);

    expect(inscription.status).toBe('PENDENTE');
    expect(inscription.payment_status).toBe('AWAITING_PAYMENT');
    expect(payment.status).toBe('AWAITING_PAYMENT');
    expect(queue.processed).toBe(1);
    expect(queue.result_status).toBe('pending');
  });

  test('increments attempts when provider call fails', async () => {
    await db.run(
      'INSERT INTO webhook_queue (payment_id, payload) VALUES (?, ?)',
      ['pay-error', JSON.stringify({ data: { id: 'pay-error' } })]
    );

    const mpClient = {
      get: jest.fn().mockRejectedValue(new Error('provider unavailable'))
    };

    await processPendingOnce(context.db, mpClient);

    const queue = await db.get('SELECT * FROM webhook_queue WHERE payment_id = ?', ['pay-error']);
    expect(queue.processed).toBe(0);
    expect(queue.attempts).toBe(1);
  });
});
