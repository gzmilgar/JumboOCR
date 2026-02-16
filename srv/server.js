const cds = require('@sap/cds');

// Health check and monitoring endpoints
cds.on('bootstrap', (app) => {
  app.get('/health', (req, res) => {
    res.status(200).send('OK');
  });
  
  app.get('/ping', (req, res) => {
    res.status(200).json({ 
      status: 'healthy', 
      service: 'jumbo-ocr-srv',
      timestamp: new Date().toISOString() 
    });
  });
});

// Start CDS server
module.exports = cds.server;