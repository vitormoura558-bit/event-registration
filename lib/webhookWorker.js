const util = require('util');

// mpClient must provide a `get({ id })` that returns a Promise resolving to payment object
async function processPendingOnce(db, mpClient, limit = 10) {
  const all = [];
  const dbAll = util.promisify(db.all).bind(db);
  const dbGet = util.promisify(db.get).bind(db);
  const dbRun = function (sql, params) {
    return new Promise((resolve, reject) => db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    }));
  };

  const rows = await dbAll('SELECT * FROM webhook_queue WHERE processed = 0 ORDER BY received_at ASC LIMIT ?', [limit]);
  for (const row of rows) {
    try {
      console.log('Processing webhook queue id=', row.id, 'payment_id=', row.payment_id);
      const payment = await mpClient.get({ id: row.payment_id });
      const externalRef = payment.external_reference;
      const status = payment.status;

      if (!externalRef) {
        console.log('Pagamento MP sem external_reference', payment);
        await dbRun('UPDATE webhook_queue SET processed = 1, processed_at = CURRENT_TIMESTAMP, result_status = ? WHERE id = ?', ['no_external_ref', row.id]);
        continue;
      }

      const now = new Date().toISOString();
      if (status === 'approved' || status === 'paid') {
        await dbRun("UPDATE inscriptions SET status = 'CONFIRMADO', mp_payment_id = ?, payment_date = ? WHERE id = ?", [String(row.payment_id), now, externalRef]);
        await dbRun('UPDATE webhook_queue SET processed = 1, processed_at = CURRENT_TIMESTAMP, result_status = ? WHERE id = ?', ['confirmed', row.id]);
        console.log(`Inscrição ${externalRef} marcada como CONFIRMADO via MP (queue id=${row.id})`);
      } else {
        await dbRun('UPDATE inscriptions SET status = ? , mp_payment_id = ? WHERE id = ?', [String(status).toUpperCase(), String(row.payment_id), externalRef]);
        await dbRun('UPDATE webhook_queue SET processed = 1, processed_at = CURRENT_TIMESTAMP, result_status = ? WHERE id = ?', [String(status).toLowerCase(), row.id]);
        console.log(`Inscrição ${externalRef} atualizada para status ${status} (queue id=${row.id})`);
      }
    } catch (err) {
      console.error('Erro processando fila webhook id=', row.id, err.message || err);
      // incrementar tentativas
      await dbRun('UPDATE webhook_queue SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    }
  }
}

module.exports = { processPendingOnce };
