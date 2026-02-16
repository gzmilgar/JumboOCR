const cds = require('@sap/cds');
const express = require('express');

const PORT = process.env.PORT || 8080;

async function start() {
  try {
    console.log('Starting CAP server...');
    
    cds.env.requires.auth = { kind: 'dummy' };
    
    const app = express();
    
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
    
    await cds.serve('srv/ocr-service').in(app);
    
    app.listen(PORT, () => {
      console.log('Server running on port ' + PORT);
    });
    
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

start();
