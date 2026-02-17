const request = require('supertest');
const bcrypt = require('bcryptjs');
const { createApp } = require('../server');

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

describe('Fluxo completo do site (integração)', () => {
  let app, db, processPendingOnce;
  beforeAll(async () => {
    // Configurar ambiente de teste
    process.env.NODE_ENV = 'test';
    process.env.LEADER_PASSWORD = 'leaderpass';

    const created = createApp({ dbPath: ':memory:', startWorker: false });
    app = created.app;
    db = created.db;
    processPendingOnce = created.processPendingOnce;

    // criar tabelas necessárias
    await runSql(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, role TEXT)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS leaders (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, whatsapp TEXT, link_name TEXT)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS inscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, age INTEGER, phone TEXT, link_name TEXT, leader_id INTEGER, mp_preference_id TEXT, mp_payment_id TEXT, payment_method TEXT, payment_date TEXT, status TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS webhook_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id TEXT, payload TEXT, received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, processed INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, processed_at TIMESTAMP, result_status TEXT)`);

    // criar um leader para o form
    await runSql(db, `INSERT INTO leaders (name, whatsapp, link_name) VALUES (?, ?, ?)`, ['Test Leader', '55819990000', 'grupo-test']);

    // criar admin user
    const hash = bcrypt.hashSync('adminpass', 10);
    await runSql(db, `INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`, ['admin', hash, 'admin']);
  });

  afterAll(() => {
    db.close();
  });

  test('Inscrição via formulário e acompanhamento', async () => {
    // GET form
    const getRes = await request(app).get('/inscrever');
    expect(getRes.status).toBe(200);
    expect(getRes.text).toMatch(/Formulário de Inscrição/);

    // POST inscrição com PIX para evitar criação de preferência MP
    const postRes = await request(app).post('/inscrever').type('form').send({
      name: 'Aluno Teste',
      age: 30,
      phone: '85999999999',
      link_name: 'grupo-test',
      payment_method: 'PIX'
    });

    expect(postRes.status).toBe(200);
    expect(postRes.text).toMatch(/Inscrição Recebida/);

    // verificar inscrição no DB
    const ins = await getSql(db, `SELECT * FROM inscriptions WHERE name = ?`, ['Aluno Teste']);
    expect(ins).toBeDefined();
    expect(ins.status).toBe('PENDENTE');

    // acompanhar via rota
    const acc = await request(app).get(`/acompanhamento/${ins.id}`);
    expect(acc.status).toBe(200);
    expect(acc.text).toMatch(/Acompanhamento de Inscrição/);
    expect(acc.text).toMatch(/PENDENTE/);
  });

  test('Login admin e acesso ao painel admin', async () => {
    const agent = request.agent(app);

    const loginRes = await agent
      .post('/login')
      .type('form')
      .send({ username: 'admin', password: 'adminpass' });

    expect(loginRes.status).toBe(200);

    const panelRes = await agent.get('/painel/admin');
    expect(panelRes.status).toBe(200);
    expect(panelRes.text).toMatch(/Painel Administrativo/);
    expect(panelRes.text).toMatch(/Aluno Teste/);
  });

  test('Login líder, confirmar inscrição via painel do líder', async () => {
    const agent = request.agent(app);

    // buscar leader id
    const leader = await getSql(db, `SELECT * FROM leaders WHERE link_name = ?`, ['grupo-test']);
    expect(leader).toBeDefined();

    // login leader
    const leaderLogin = await agent
      .post('/leader/login')
      .type('form')
      .send({ link_name: 'grupo-test', password: 'leaderpass' });
    expect(leaderLogin.status).toBe(200);

    // pegar inscrição
    const ins = await getSql(db, `SELECT * FROM inscriptions WHERE name = ?`, ['Aluno Teste']);
    expect(ins).toBeDefined();

    // acessar painel do líder
    const panelL = await agent.get(`/painel/lider/${leader.id}`);
    expect(panelL.status).toBe(200);
    expect(panelL.text).toMatch(/Painel do Líder/);

    // confirmar inscrição
    const confirm = await agent.post(`/painel/lider/${leader.id}/confirmar/${ins.id}`);
    expect(confirm.status).toBe(200);

    const updated = await getSql(db, `SELECT * FROM inscriptions WHERE id = ?`, [ins.id]);
    expect(updated.status).toBe('CONFIRMADO');
  });
});