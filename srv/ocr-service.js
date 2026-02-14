const cds = require('@sap/cds');

module.exports = cds.service.impl(async function() {
  const { PurchaseOrders, LineItems } = this.entities;
  
  // Custom action implementation
  this.on('createPOFromExtraction', async (req) => {
    const extractionData = JSON.parse(req.data.extractionData);
    
    // Map header fields
    const headerData = {};
    extractionData.extraction.headerFields.forEach(field => {
      headerData[field.name] = field.value;
    });
    
    // Map line items
    const lineItemsData = extractionData.extraction.lineItems.map((item, index) => {
      const lineData = { itemNumber: String(index + 1) };
      item.forEach(field => {
        lineData[field.name] = field.value;
      });
      return lineData;
    });
    
    // Create PO with line items
    const result = await INSERT.into(PurchaseOrders).entries({
      ...headerData,
      extractionConfidence: extractionData.extraction.confidence,
      processingStatus: 'EXTRACTED',
      lineItems: lineItemsData
    });
    
    return result;
  });
});