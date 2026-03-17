# Relatorio Total do Projeto

Data: 2026-03-17
Projeto: event-registration
Diretorio principal: `C:\Users\PC\OneDrive\Área de Trabalho\projet\Backup_Site_One\Backup_Site_One\event-registration`

## 1. Visao geral

O sistema e uma aplicacao web para inscricoes em eventos com:

- inscricao publica
- painel de lider
- painel administrativo
- pagamentos manuais e via Mercado Pago
- acompanhamento de status por inscricao
- persistencia local em SQLite

Stack principal:

- Node.js
- Express
- SQLite
- EJS
- bcryptjs
- Jest + Supertest

## 2. Estrutura funcional atual

### 2.1 Fluxo publico

- rota publica de inscricao em `/inscrever`
- criacao de inscricao com associacao a lider
- tela de confirmacao apos envio
- tela de acompanhamento por ID em `/acompanhamento/:id`

### 2.2 Autenticacao

- admin com usuario e senha
- lider com `link_name` + senha global
- senha global dos lideres definida pelo admin

### 2.3 Painel admin

- login administrativo em `/login`
- visualizacao geral das inscricoes
- cadastro de lideres
- edicao de lideres
- remocao de lideres sem inscricoes vinculadas
- configuracao da senha global dos lideres
- contagem de lideres

### 2.4 Painel lider

- login de lider em `/leader/login`
- visualizacao das inscricoes do proprio grupo
- confirmacao manual de inscricoes

### 2.5 Pagamentos

Metodos suportados:

- PIX
- Presencial
- MercadoPago

Regras atuais:

- PIX e Presencial seguem fluxo manual
- Mercado Pago segue fluxo automatizado com preferencia, webhook, fila e worker
- o sistema separa status da inscricao e status do pagamento

## 3. Melhorias implementadas

### 3.1 Correcao de autenticacao e navegacao

Foram corrigidos:

- criacao de rotas GET para `/login` e `/leader/login`
- estrutura de login do lider
- `admin-start.js` para usar corretamente o retorno de `createApp()`
- formularios com protecao CSRF
- escopo dos middlewares de lider e admin para nao interceptar rotas publicas e webhook

### 3.2 Modelo de lider com senha global

Foi implantado:

- tabela `settings`
- chave `leader_password_hash`
- login do lider com `link_name` + senha global
- gestao dessa senha no painel admin

### 3.3 Gestao de lideres

Foi implantado no painel admin:

- cadastro de lider
- edicao inline
- remocao com bloqueio quando ha inscricoes vinculadas

### 3.4 Estrutura de pagamento reforcada

Foi implantado:

- tabela `payments`
- colunas `payment_status` e `paid_at` em `inscriptions`
- registro separado por pagamento
- sincronizacao entre `inscriptions` e `payments`
- mapeamento de status do Mercado Pago para status internos
- backfill para registros antigos

Status internos principais de pagamento:

- `PENDING`
- `REPORTED`
- `AWAITING_PAYMENT`
- `PAID`
- `FAILED`
- `CANCELLED`
- `ERROR`

### 3.5 Interface

As telas passaram a exibir com mais clareza:

- status da inscricao
- status do pagamento
- data de pagamento/confirmacao

## 4. Banco de dados

Tabelas principais em uso:

- `users`
- `leaders`
- `inscriptions`
- `payments`
- `webhook_queue`
- `settings`

Campos relevantes em `inscriptions`:

- `payment_method`
- `payment_date`
- `payment_status`
- `paid_at`
- `status`
- `mp_preference_id`
- `mp_payment_id`

Campos relevantes em `payments`:

- `provider`
- `method`
- `amount`
- `status`
- `external_reference`
- `provider_reference_id`
- `provider_preference_id`
- `paid_at`
- `payload`

## 5. Suite de testes criada

Arquivos adicionados:

- `tests/app.http.test.js`
- `tests/webhook.http.test.js`
- `tests/webhookWorker.test.js`
- `tests/helpers/db.js`
- `scripts/run-tests.js`

Cobertura atual:

- renderizacao das telas de login
- criacao de inscricao com pagamento manual
- autenticacao de lider
- confirmacao manual pelo lider
- enfileiramento do webhook
- validacao de webhook sem ID
- processamento de pagamento aprovado
- processamento de pagamento pendente
- incremento de tentativas quando o provider falha

Execucao:

- comando: `npm test`
- resultado validado: 3 suites aprovadas
- total validado: 8 testes aprovados

## 6. Validacao ponta a ponta

Fluxo completo validado manualmente via HTTP:

- login admin
- definicao da senha global dos lideres
- cadastro de lider
- inscricao publica com PIX
- acompanhamento inicial `PENDENTE / REPORTED`
- login do lider
- confirmacao manual da inscricao
- acompanhamento final `CONFIRMADO / PAID`
- painel admin refletindo o novo status

## 7. Enderecos do sistema

Quando os servidores sao iniciados:

- publico: `http://127.0.0.1:3000/inscrever`
- admin: `http://127.0.0.1:30001/login`

Comandos:

- servidor principal: `npm start`
- servidor admin: `npm run start:admin`
- testes: `npm test`

## 8. Arquivos principais alterados

- `server.js`
- `admin-start.js`
- `routes/public.routes.js`
- `routes/leader.routes.js`
- `routes/admin.routes.js`
- `views/form.ejs`
- `views/login.ejs`
- `views/leader_login.ejs`
- `views/confirm.ejs`
- `views/acompanhamento.ejs`
- `views/painel_lider.ejs`
- `views/painel_admin.ejs`
- `package.json`

## 9. Situacao atual

Estado geral:

- sistema funcional
- autenticacao admin funcional
- autenticacao lider funcional
- painel admin funcional
- painel lider funcional
- pagamentos manuais estruturados
- pagamentos Mercado Pago estruturados
- suite de testes criada e operacional

## 10. Pontos que ainda podem evoluir

- criar logout para admin e lider
- adicionar testes E2E com navegador
- reduzir logs de console em ambiente de teste
- adicionar healthcheck
- adicionar pagina de monitoramento da fila de webhook
- adicionar filtros e busca no painel admin
- criar gestao de valor do evento pelo admin
- separar configuracoes sensiveis em interface mais controlada

## 11. Conclusao

O projeto saiu de um estado funcional, mas inconsistente em alguns fluxos criticos, para um estado mais solido, com:

- autenticacao coerente
- controle administrativo de lideres
- estrutura de pagamento melhor modelada
- protecoes corrigidas
- testes automatizados
- validacao ponta a ponta bem-sucedida

No estado atual, o sistema esta apto para continuidade de desenvolvimento com uma base bem mais segura e organizada.
