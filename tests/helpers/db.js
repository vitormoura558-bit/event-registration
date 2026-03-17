const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const { createApp } = require('../../server');

function createTestContext(options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'event-registration-test-'));
  const dbPath = path.join(tempDir, 'test.sqlite');
  const context = createApp({ dbPath, startWorker: false, ...options });

  return {
    ...context,
    dbPath,
    tempDir
  };
}

function getDbHelpers(db) {
  const get = util.promisify(db.get).bind(db);
  const all = util.promisify(db.all).bind(db);
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

  const close = () => new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  return { get, all, run, close };
}

async function waitForDatabaseReady(db, timeoutMs = 1000) {
  const helpers = getDbHelpers(db);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const columns = await helpers.all('PRAGMA table_info(inscriptions)');
      const hasPaymentStatus = columns.some((column) => column.name === 'payment_status');
      const hasPaidAt = columns.some((column) => column.name === 'paid_at');
      await helpers.all('SELECT * FROM payments LIMIT 1');

      if (hasPaymentStatus && hasPaidAt) {
        return;
      }
    } catch (err) {
      // Keep polling while the schema finishes initializing.
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('Timed out waiting for database schema initialization');
}

async function destroyTestContext(context) {
  await getDbHelpers(context.db).close();
  fs.rmSync(context.tempDir, { recursive: true, force: true });
}

module.exports = {
  createTestContext,
  destroyTestContext,
  getDbHelpers,
  waitForDatabaseReady
};
