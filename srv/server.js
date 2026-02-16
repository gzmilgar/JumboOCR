const cds = require('@sap/cds');
const express = require('express');

const PORT = process.env.PORT || 8080;

async function start() {
  try {
    console.log('Starting CAP server...');
    
    // Create Express app
    const app = express();
    
    // Health endpoints
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
    
    // Serve CDS services
    await cds.serve('srv/ocr-service').in(app);
    
    // Start listening
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
      console.log(`OData service: http://localhost:${PORT}/odata/v4/ocr`);
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();