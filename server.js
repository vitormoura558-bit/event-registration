const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const csrf = require('csurf');
const rateLimit = require('express-rate-limit');
// Carregar variáveis de ambiente de .env (se existir)
require('dotenv').config();

const sqlite3 = require('sqlite3').verbose();
const MP = require('mercadopago');
const { processPendingOnce } = require('./lib/webhookWorker');

function createApp(options = {}) {
  const dbPath = options.dbPath || './db.sqlite';
  const mpConfig = new (MP.default || MP.MercadoPagoConfig)({ accessToken: process.env.MP_ACCESS_TOKEN || '' });
  const mpPayment = new MP.Payment(mpConfig);

  const app = express();

  // Configuração do EJS
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  // Arquivos estáticos / configurações compartilhadas
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(bodyParser.urlencoded({ extended: true }));

  // Parse JSON and keep raw body for webhook verification
  app.use(express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  }));

  // Sessões (simples) - MOVIDO PARA ANTES DO CSRF
  app.use(session({
    secret: process.env.SESSION_SECRET || 'dev_session_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));

  // CSRF protection (exceto webhook e ambiente de teste)
  if (process.env.NODE_ENV !== 'test') {
    const csrfProtection = csrf({ cookie: false });
    app.use((req, res, next) => {
      if (req.path.startsWith('/mp/webhook')) return next();
      return csrfProtection(req, res, next);
    });
    // Expor csrfToken para todas as views
    app.use((req, res, next) => {
      res.locals.csrfToken = req.csrfToken ? req.csrfToken() : '';
      next();
    });
  } else {
    app.use((req, res, next) => {
      res.locals.csrfToken = '';
      next();
    });
  }

  // Conectar ao banco SQLite
  const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error(err.message);
    else console.log('Conectado ao banco SQLite.');
  });

  // Criar tabelas se não existirem
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password_hash TEXT,
      role TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS leaders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      whatsapp TEXT,
      link_name TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS inscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      age INTEGER,
      phone TEXT,
      link_name TEXT,
      leader_id INTEGER,
      mp_preference_id TEXT,
      mp_payment_id TEXT,
      payment_method TEXT,
      payment_date TEXT,
      status TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(leader_id) REFERENCES leaders(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS webhook_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id TEXT,
      payload TEXT,
      received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      processed INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      processed_at TIMESTAMP,
      result_status TEXT
    )`);
  });

  // Passar db para rotas
  const attachDb = (req, res, next) => { req.db = db; next(); };
  app.use(attachDb);

  // Rate limit para login
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 10, // 10 tentativas por IP
    message: 'Muitas tentativas de login, tente novamente mais tarde.'
  });
// Importar os novos roteadores
const publicRouter = require('./routes/public.routes');
const leaderRouter = require('./routes/leader.routes');
const adminRouter = require('./routes/admin.routes');

// Aplicar rate limit apenas nas rotas de login (permanece)
app.use('/login', loginLimiter);
app.use('/leader/login', loginLimiter);

// Usar os roteadores
app.use('/', publicRouter);
app.use('/', leaderRouter);
app.use('/', adminRouter);

  // Endpoint para receber notificações do Mercado Pago (webhook)
  app.post('/mp/webhook', (req, res) => {
    const webhookSecret = process.env.MP_WEBHOOK_SECRET;
    const raw = req.rawBody || Buffer.from('');
    let signatureHeader = (req.get('x-mp-signature') || req.get('x-mercadopago-signature') || '').toString();

    if (webhookSecret) {
      // compute expected signature in hex and base64
      const expectedHex = crypto.createHmac('sha256', webhookSecret).update(raw).digest('hex');
      const expectedBase64 = crypto.createHmac('sha256', webhookSecret).update(raw).digest('base64');

      // normalize header (remove possible prefixes like "sha256=")
      signatureHeader = signatureHeader.replace(/^sha256=/i, '');

      const headerBuf = Buffer.from(signatureHeader, 'utf8');
      const expectedHexBuf = Buffer.from(expectedHex, 'utf8');
      const expectedBase64Buf = Buffer.from(expectedBase64, 'utf8');

      let valid = false;
      try {
        if (headerBuf.length === expectedHexBuf.length) {
          valid = crypto.timingSafeEqual(headerBuf, expectedHexBuf);
        }
        if (!valid && headerBuf.length === expectedBase64Buf.length) {
          valid = crypto.timingSafeEqual(headerBuf, expectedBase64Buf);
        }
      } catch (e) {
        valid = false;
      }

      if (!signatureHeader || !valid) {
        console.warn('Webhook MP com assinatura inválida', { signatureHeader, expectedHex, expectedBase64 });
        return res.status(403).send('Invalid signature');
      }
    } else {
      console.warn('MP_WEBHOOK_SECRET não configurado — webhook será aceito sem verificação');
    }

    const idFromQuery = req.query.id || req.body.id || req.body['data.id'] || req.body.data_id;
    const paymentId = idFromQuery || (req.body && req.body.data && req.body.data.id) || null;
    if (!paymentId) return res.status(400).send('No payment id');

    const payloadStr = JSON.stringify(req.body || {});
    db.run('INSERT INTO webhook_queue (payment_id, payload) VALUES (?, ?)', [String(paymentId), payloadStr], function (err) {
      if (err) {
        console.error('Erro ao enfileirar webhook:', err.message);
        return res.status(500).send('error');
      }
      console.log(`Webhook enfileirado (id=${this.lastID}, payment_id=${paymentId})`);
      return res.status(200).send('queued');
    });
  });

  // Iniciar worker de processamento assíncrono (opcional)
  const WORKER_INTERVAL_MS = parseInt(process.env.WEBHOOK_WORKER_INTERVAL_MS || '5000', 10);
  if (options.startWorker !== false && process.env.WEBHOOK_WORKER !== 'false') {
    setInterval(() => {
      processPendingOnce(db, mpPayment).catch(err => console.error('Erro worker:', err));
    }, WORKER_INTERVAL_MS);
  }

  return { app, db, mpPayment, processPendingOnce };
}

if (require.main === module) {
  const { app } = createApp({});
  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}

module.exports = { createApp };
