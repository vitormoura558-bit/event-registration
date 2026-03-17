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
      link_name TEXT,
      password_hash TEXT
    )`);

    db.all('PRAGMA table_info(leaders)', [], (err, columns) => {
      if (err) {
        console.error('Erro ao verificar schema de leaders:', err.message);
        return;
      }

      const hasPasswordHash = Array.isArray(columns) && columns.some((column) => column.name === 'password_hash');
      if (!hasPasswordHash) {
        db.run('ALTER TABLE leaders ADD COLUMN password_hash TEXT', (alterErr) => {
          if (alterErr) {
            console.error('Erro ao adicionar password_hash em leaders:', alterErr.message);
          }
        });
      }
    });

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
      payment_status TEXT DEFAULT 'PENDING',
      paid_at TEXT,
      status TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(leader_id) REFERENCES leaders(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inscription_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      method TEXT NOT NULL,
      amount REAL,
      status TEXT NOT NULL,
      external_reference TEXT,
      provider_reference_id TEXT,
      provider_preference_id TEXT,
      payload TEXT,
      paid_at TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(inscription_id) REFERENCES inscriptions(id)
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

    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    db.all('PRAGMA table_info(inscriptions)', [], (err, columns) => {
      if (err) {
        console.error('Erro ao verificar schema de inscriptions:', err.message);
        return;
      }

      const hasMpPreferenceId = Array.isArray(columns) && columns.some((column) => column.name === 'mp_preference_id');
      const hasMpPaymentId = Array.isArray(columns) && columns.some((column) => column.name === 'mp_payment_id');
      const hasPaymentStatus = Array.isArray(columns) && columns.some((column) => column.name === 'payment_status');
      const hasPaidAt = Array.isArray(columns) && columns.some((column) => column.name === 'paid_at');

      const backfillPayments = () => {
        db.run(`
          UPDATE inscriptions
          SET payment_status = CASE
            WHEN status = 'CONFIRMADO' THEN 'PAID'
            WHEN payment_method IN ('MercadoPago', 'MP') THEN 'AWAITING_PAYMENT'
            WHEN payment_method IN ('PIX', 'Presencial') AND payment_date IS NOT NULL AND payment_date <> '' THEN 'REPORTED'
            ELSE 'PENDING'
          END
          WHERE payment_status IS NULL OR payment_status = ''
        `, (updateErr) => {
          if (updateErr) {
            console.error('Erro ao atualizar payment_status em inscriptions:', updateErr.message);
            return;
          }

          db.run(`
            INSERT INTO payments (
              inscription_id,
              provider,
              method,
              amount,
              status,
              external_reference,
              provider_reference_id,
              provider_preference_id,
              paid_at,
              payload,
              updated_at
            )
            SELECT
              i.id,
              CASE
                WHEN i.payment_method IN ('MercadoPago', 'MP') THEN 'MERCADO_PAGO'
                ELSE 'MANUAL'
              END,
              COALESCE(i.payment_method, 'MANUAL'),
              NULL,
              COALESCE(i.payment_status, 'PENDING'),
              CAST(i.id AS TEXT),
              i.mp_payment_id,
              i.mp_preference_id,
              i.paid_at,
              '{}',
              CURRENT_TIMESTAMP
            FROM inscriptions i
            WHERE NOT EXISTS (
              SELECT 1 FROM payments p WHERE p.inscription_id = i.id
            )
          `, (backfillErr) => {
            if (backfillErr) {
              console.error('Erro ao popular pagamentos existentes:', backfillErr.message);
            }
          });
        });
      };

      const ensurePaidAt = () => {
        if (hasPaidAt) {
          backfillPayments();
          return;
        }

        db.run(`ALTER TABLE inscriptions ADD COLUMN paid_at TEXT`, (alterErr) => {
          if (alterErr) {
            console.error('Erro ao adicionar coluna paid_at em inscriptions:', alterErr.message);
            return;
          }
          backfillPayments();
        });
      };

      const ensurePaymentStatus = () => {
        if (hasPaymentStatus) {
          ensurePaidAt();
          return;
        }

        db.run(`ALTER TABLE inscriptions ADD COLUMN payment_status TEXT DEFAULT 'PENDING'`, (alterErr) => {
          if (alterErr) {
            console.error('Erro ao adicionar coluna payment_status em inscriptions:', alterErr.message);
            return;
          }
          ensurePaidAt();
        });
      };

      const ensureMpPaymentId = () => {
        if (hasMpPaymentId) {
          ensurePaymentStatus();
          return;
        }

        db.run(`ALTER TABLE inscriptions ADD COLUMN mp_payment_id TEXT`, (alterErr) => {
          if (alterErr) {
            console.error('Erro ao adicionar coluna mp_payment_id em inscriptions:', alterErr.message);
            return;
          }
          ensurePaymentStatus();
        });
      };

      const ensureMpPreferenceId = () => {
        if (hasMpPreferenceId) {
          ensureMpPaymentId();
          return;
        }

        db.run(`ALTER TABLE inscriptions ADD COLUMN mp_preference_id TEXT`, (alterErr) => {
          if (alterErr) {
            console.error('Erro ao adicionar coluna mp_preference_id em inscriptions:', alterErr.message);
            return;
          }
          ensureMpPaymentId();
        });
      };

      ensureMpPreferenceId();
    });
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

  app.use('/', leaderRouter);
  app.use('/', adminRouter);

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
