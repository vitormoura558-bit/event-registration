const { createApp } = require('./server');

(async () => {
  const { app } = createApp({});
  const PORT_ADMIN = process.env.PORT_ADMIN || 30001;
  app.listen(PORT_ADMIN, () => {
    console.log(`Admin server rodando em http://localhost:${PORT_ADMIN}`);
  });
})();
