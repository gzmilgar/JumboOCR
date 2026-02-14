const cds = require('@sap/cds');

// Bootstrap event - authentication'ı bypass et
cds.on('bootstrap', app => {
  // CORS headers ekle
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });
  
  // Mock user for all requests (authentication bypass)
  app.use((req, res, next) => {
    req.user = new cds.User.Privileged({ id: 'anonymous' });
    next();
  });
});

module.exports = cds.server;