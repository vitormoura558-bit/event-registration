const { createApp } = require('./server');

(async () => {
  const { adminApp } = createApp({});
  const PORT_ADMIN = process.env.PORT_ADMIN || 30001;
  adminApp.listen(PORT_ADMIN, () => {
    console.log(`Admin server rodando em http://localhost:${PORT_ADMIN}`);
  });
})();
