const request = require('supertest');
const { createTestContext, destroyTestContext, getDbHelpers, waitForDatabaseReady } = require('./helpers/db');

describe('Mercado Pago webhook HTTP', () => {
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

  test('queues webhook notification for later processing', async () => {
    const response = await request(context.app)
      .post('/mp/webhook')
      .send({
        data: { id: 'mp-123' }
      })
      .expect(200);

    expect(response.text).toBe('queued');

    const row = await db.get('SELECT * FROM webhook_queue WHERE payment_id = ?', ['mp-123']);
    expect(row).toBeTruthy();
    expect(row.processed).toBe(0);
  });

  test('rejects webhook without payment id', async () => {
    await request(context.app)
      .post('/mp/webhook')
      .send({ type: 'payment' })
      .expect(400);
  });
});
