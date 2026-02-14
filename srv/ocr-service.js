const cds = require('@sap/cds');

module.exports = cds.service.impl(async function() {
  const { PurchaseOrders, LineItems } = this.entities;
  
  // Custom action implementation for Document AI extraction
  this.on('createPOFromExtraction', async (req) => {
    try {
      console.log('=== createPOFromExtraction called ===');
      console.log('Raw input:', JSON.stringify(req.data));
      
      // Parse extraction data (comes as JSON string from SAP Build)
      let extractionData;
      
      // Handle both string and object inputs
      if (typeof req.data.extractionData === 'string') {
        extractionData = JSON.parse(req.data.extractionData);
      } else {
        extractionData = req.data.extractionData;
      }
      
      console.log('Parsed extractionData:', JSON.stringify(extractionData, null, 2));
      
      // Validate structure
      if (!extractionData || !extractionData.extraction) {
        throw new Error('Invalid input: extraction data missing');
      }
      
      const extraction = extractionData.extraction;
      
      if (!extraction.headerFields) {
        throw new Error('Invalid input: headerFields missing');
      }
      
      // Map header fields from Document AI extraction
      const headerData = {};
      extraction.headerFields.forEach(field => {
        if (field.name && field.value !== undefined) {
          headerData[field.name] = field.value;
        }
      });
      
      console.log('Header data:', headerData);
      
      // Map line items from Document AI extraction
      const lineItemsData = [];
      if (extraction.lineItems && Array.isArray(extraction.lineItems)) {
        extraction.lineItems.forEach((item, index) => {
          const lineData = { itemNumber: String(index + 1) };
          if (Array.isArray(item)) {
            item.forEach(field => {
              if (field.name && field.value !== undefined) {
                lineData[field.name] = field.value;
              }
            });
          }
          lineItemsData.push(lineData);
        });
      }
      
      console.log('Line items data:', lineItemsData);
      
      // Create PO with line items in a transaction
      return await cds.transaction(req, async tx => {
        // Insert PurchaseOrder
        const poResult = await INSERT.into(PurchaseOrders).entries({
          ...headerData,
          extractionConfidence: extraction.confidence || 0.0,
          processingStatus: 'EXTRACTED'
        });
        
        console.log('PO created:', poResult);
        
        // Get the created PO ID
        const poId = poResult.ID || poResult.id;
        
        // Insert LineItems if any
        if (lineItemsData.length > 0) {
          const lineItemsWithPO = lineItemsData.map(item => ({
            ...item,
            purchaseOrder_ID: poId
          }));
          
          await INSERT.into(LineItems).entries(lineItemsWithPO);
          console.log('Line items created:', lineItemsData.length);
        }
        
        // Fetch and return the created PO
        const createdPO = await SELECT.one.from(PurchaseOrders).where({ ID: poId });
        console.log('=== createPOFromExtraction completed successfully ===');
        
        return createdPO;
      });
      
    } catch (error) {
      console.error('=== Error in createPOFromExtraction ===');
      console.error('Error:', error);
      console.error('Stack:', error.stack);
      console.error('Input data:', req.data);
      throw error;
    }
  });
});