const http = require('http');
const crypto = require('crypto');

// Uso: MP_WEBHOOK_SECRET=segredo node scripts/test_webhook.js
const secret = process.env.MP_WEBHOOK_SECRET || null;
const host = process.env.TEST_HOST || 'localhost';
const port = process.env.TEST_PORT || 3000;

function send(bodyObj, signature) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj);
    const options = {
      hostname: host,
      port: port,
      path: '/mp/webhook',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    if (signature) options.headers['x-mp-signature'] = signature;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log('Teste de webhook iniciando em http://' + host + ':' + port + '/mp/webhook');

  if (secret) console.log('Usando segredo de webhook vindo de MP_WEBHOOK_SECRET');
  else console.log('Nenhum segredo MP_WEBHOOK_SECRET definido; servidor deve aceitar webhooks sem verificação.');

  // Teste 1: sem assinatura
  try {
    const res1 = await send({ test: 'no-id' }, null);
    console.log('[1] sem assinatura -> status', res1.statusCode);
  } catch (e) {
    console.error('[1] erro', e.message);
  }

  // Teste 2: com assinatura correta (mas sem payment id, espera 400 'No payment id')
  try {
    const body = { test: 'no-id' };
    const bodyStr = JSON.stringify(body);
    const sig = secret ? crypto.createHmac('sha256', secret).update(Buffer.from(bodyStr)).digest('hex') : null;
    const res2 = await send(body, sig);
    console.log('[2] com assinatura correta -> status', res2.statusCode);
  } catch (e) {
    console.error('[2] erro', e.message);
  }

  console.log('Teste finalizado. Interprete status codes: 403 = assinatura inválida, 400 = payload sem payment id (esperado para este teste).');
})();
