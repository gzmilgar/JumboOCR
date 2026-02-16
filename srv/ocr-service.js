const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

module.exports = cds.service.impl(async function() {
  
  this.on('createSalesOrderFromExtraction', async (req) => {
    try {
      console.log('=== createSalesOrderFromExtraction called ===');
      console.log('Raw input:', JSON.stringify(req.data));
      
      // Parse extraction data
      let extractionData;
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
      
      // Map Document AI data to S/4HANA format
      const headerData = mapHeaderFields(extraction.headerFields);
      const lineItems = mapLineItems(extraction.lineItems);
      
      console.log('Mapped header data:', JSON.stringify(headerData, null, 2));
      console.log('Mapped line items:', JSON.stringify(lineItems, null, 2));
      
      // Validate before calling S/4HANA
      validateBeforeS4HANA(headerData, lineItems);
      
      // Create Sales Order in S/4HANA
      console.log('Calling S/4HANA Sales Order API...');
      const salesOrderNumber = await createSalesOrderInS4HANA(headerData, lineItems);
      
      console.log('✅ Sales Order created successfully:', salesOrderNumber);
      
      return {
        salesOrderNumber: salesOrderNumber,
        message: `Sales Order ${salesOrderNumber} created successfully from PO ${headerData.documentNumber}`,
        success: true
      };
      
    } catch (error) {
      console.error('❌ Error in createSalesOrderFromExtraction:', error);
      console.error('Stack trace:', error.stack);
      
      return {
        salesOrderNumber: null,
        message: `Failed to create Sales Order: ${error.message}`,
        success: false
      };
    }
  });
  
  this.on('validateExtraction', async (req) => {
    try {
      console.log('=== validateExtraction called ===');
      
      let extractionData;
      if (typeof req.data.extractionData === 'string') {
        extractionData = JSON.parse(req.data.extractionData);
      } else {
        extractionData = req.data.extractionData;
      }
      
      const errors = [];
      
      // Check structure
      if (!extractionData?.extraction?.headerFields) {
        errors.push('Missing header fields in extraction data');
      }
      
      if (!extractionData?.extraction?.lineItems || extractionData.extraction.lineItems.length === 0) {
        errors.push('Missing or empty line items');
      }
      
      // Validate header data
      if (extractionData?.extraction?.headerFields) {
        const headerData = mapHeaderFields(extractionData.extraction.headerFields);
        
        if (!headerData.receiverId) {
          errors.push('Missing customer/receiver ID');
        }
        
        if (!headerData.documentNumber) {
          errors.push('Missing PO number');
        }
        
        if (!headerData.currencyCode) {
          errors.push('Missing currency code');
        }
      }
      
      // Validate line items
      if (extractionData?.extraction?.lineItems) {
        const lineItems = mapLineItems(extractionData.extraction.lineItems);
        
        lineItems.forEach((item, index) => {
          if (!item.materialNumber && !item.customerMaterialNumber) {
            errors.push(`Line ${index + 1}: Missing material number`);
          }
          
          if (!item.quantity || item.quantity <= 0) {
            errors.push(`Line ${index + 1}: Invalid or missing quantity`);
          }
        });
      }
      
      console.log('Validation result:', { valid: errors.length === 0, errors });
      
      return {
        valid: errors.length === 0,
        errors: errors
      };
      
    } catch (error) {
      console.error('Validation error:', error);
      return {
        valid: false,
        errors: [`Validation failed: ${error.message}`]
      };
    }
  });
  
  /**
   * Map Document AI header fields to internal format
   */
  function mapHeaderFields(headerFields) {
    const data = {};
    
    if (!Array.isArray(headerFields)) return data;
    
    headerFields.forEach(field => {
      if (field.name && field.value !== undefined && field.value !== null && field.value !== "") {
        switch(field.name) {
          case 'purchaseOrder':
            data.documentNumber = field.value;
            break;
          case 'vendorNo':
            data.senderId = field.value;
            break;
          case 'vendorAdress':
            data.vendorAddress = field.value;
            break;
          case 'deliveryAdress':
            data.shipToAddress = field.value;
            break;
          case 'netAmount':
          case 'grossAmount':
          case 'discount':
          case 'totalVAT':
            data[field.name] = parseFloat(field.value) || 0;
            break;
          default:
            data[field.name] = field.value;
        }
      }
    });
    
    return data;
  }
  
  /**
   * Map Document AI line items to internal format
   */
  function mapLineItems(lineItems) {
    if (!Array.isArray(lineItems)) return [];
    
    return lineItems.map(item => {
      const lineData = {};
      
      if (Array.isArray(item)) {
        item.forEach(field => {
          if (field.name && field.value !== undefined && field.value !== null && field.value !== "") {
            switch(field.name) {
              case 'DiscValue':
                lineData.discountValue = parseFloat(field.value) || 0;
                break;
              case 'VATValue':
                lineData.vatValue = parseFloat(field.value) || 0;
                break;
              case 'DeliveryDate':
                lineData.deliveryDate = field.value;
                break;
              case 'quantity':
              case 'unitPrice':
              case 'netAmount':
              case 'grossAmount':
                lineData[field.name] = parseFloat(field.value) || 0;
                break;
              default:
                lineData[field.name] = field.value;
            }
          }
        });
      }
      
      return lineData;
    }).filter(item => Object.keys(item).length > 0);
  }
  
  /**
   * Validate data before calling S/4HANA
   */
  function validateBeforeS4HANA(headerData, lineItems) {
    const errors = [];
    
    // Required header fields
    if (!headerData.receiverId) {
      errors.push('Customer ID (receiverId) is required');
    }
    
    if (!headerData.documentNumber) {
      errors.push('PO number (documentNumber) is required');
    }
    
    if (!headerData.currencyCode) {
      errors.push('Currency code is required');
    }
    
    // Line items validation
    if (!lineItems || lineItems.length === 0) {
      errors.push('At least one line item is required');
    }
    
    lineItems.forEach((item, index) => {
      if (!item.materialNumber && !item.customerMaterialNumber) {
        errors.push(`Line ${index + 1}: Material number is required`);
      }
      
      if (!item.quantity || item.quantity <= 0) {
        errors.push(`Line ${index + 1}: Valid quantity is required`);
      }
    });
    
    if (errors.length > 0) {
      throw new Error('Validation failed: ' + errors.join('; '));
    }
  }
  
  /**
   * Create Sales Order in S/4HANA via handheldterminal_cap destination
   */
  async function createSalesOrderInS4HANA(headerData, lineItems) {
    // S/4HANA configuration from environment variables
    const SALES_ORG = process.env.S4HANA_SALES_ORG || "1710";
    const DISTRIBUTION_CHANNEL = process.env.S4HANA_DIST_CHANNEL || "10";
    const DIVISION = process.env.S4HANA_DIVISION || "00";
    const SALES_ORDER_TYPE = process.env.S4HANA_SO_TYPE || "OR";
    
    // Build S/4HANA Sales Order payload
    const salesOrderPayload = {
      SalesOrderType: SALES_ORDER_TYPE,
      SalesOrganization: SALES_ORG,
      DistributionChannel: DISTRIBUTION_CHANNEL,
      OrganizationDivision: DIVISION,
      
      // Customer number - mapped from receiverId
      SoldToParty: mapCustomerNumber(headerData.receiverId),
      
      // PO reference
      PurchaseOrderByCustomer: headerData.documentNumber,
      
      // Delivery date
      RequestedDeliveryDate: formatDateForS4HANA(headerData.deliveryDate || headerData.validity),
      
      // Currency
      TransactionCurrency: headerData.currencyCode || "AED",
      
      // Line items
      to_Item: lineItems.map((item, index) => ({
        SalesOrderItem: String((index + 1) * 10).padStart(6, '0'), // 000010, 000020, etc.
        Material: mapMaterialNumber(item.materialNumber || item.customerMaterialNumber),
        OrderQuantity: String(item.quantity || 1),
        OrderQuantityUnit: item.unitOfMeasure || "EA",
        ItemDescription: item.description ? item.description.substring(0, 40) : ""
      }))
    };
    
    console.log('S/4HANA Sales Order Payload:', JSON.stringify(salesOrderPayload, null, 2));
    
    try {
      // ✅ Call S/4HANA via handheldterminal_cap destination
      const response = await executeHttpRequest(
        { destinationName: 'handheldterminal_cap' },
        {
          method: 'POST',
          url: '/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder',
          data: salesOrderPayload,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 60000  // 60 seconds (matches HTML5.Timeout)
        }
      );
      
      console.log('S/4HANA Response:', JSON.stringify(response.data, null, 2));
      
      // Parse OData v2 response
      const salesOrder = response.data?.d?.SalesOrder;
      
      if (!salesOrder) {
        throw new Error('No SalesOrder number in S/4HANA response');
      }
      
      return salesOrder;
      
    } catch (error) {
      console.error('S/4HANA API Error:', error);
      
      // Parse S/4HANA error message
      let errorMessage = 'Unknown error';
      
      if (error.response?.data?.error?.message?.value) {
        errorMessage = error.response.data.error.message.value;
      } else if (error.response?.data?.error?.innererror?.errordetails) {
        const details = error.response.data.error.innererror.errordetails;
        errorMessage = details.map(d => d.message).join('; ');
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      throw new Error(`S/4HANA Sales Order creation failed: ${errorMessage}`);
    }
  }
  
  /**
   * Map PO receiverId to S/4HANA customer number
   * TODO: Implement real mapping logic based on your system
   */
  function mapCustomerNumber(receiverId) {
    if (!receiverId) {
      throw new Error('Customer ID (receiverId) is required');
    }
    
    // TODO: Replace with real mapping
    // Option 1: Direct mapping (if receiverId is already customer number)
    // return receiverId;
    
    // Option 2: Mapping table (if receiverId is store code)
    const customerMapping = {
      "070073": "0001000015",  // Store ID → Customer Number
      "070074": "0001000016",
      "070075": "0001000017"
    };
    
    const mappedCustomer = customerMapping[receiverId];
    
    if (!mappedCustomer) {
      console.warn(`No mapping found for receiverId: ${receiverId}, using as-is`);
      return receiverId;
    }
    
    console.log(`Customer mapping: ${receiverId} → ${mappedCustomer}`);
    return mappedCustomer;
  }
  
  /**
   * Map material number to S/4HANA format
   * TODO: Implement real mapping logic based on your system
   */
  function mapMaterialNumber(materialCode) {
    if (!materialCode) {
      throw new Error('Material number is required');
    }
    
    // TODO: Replace with real mapping if needed
    // Option 1: Direct use (if material codes match S/4HANA)
    // Option 2: Padding with leading zeros (common for SAP)
    const paddedMaterial = String(materialCode).padStart(18, '0');
    
    console.log(`Material mapping: ${materialCode} → ${paddedMaterial}`);
    return paddedMaterial;
  }
  
  /**
   * Format date for S/4HANA (YYYY-MM-DD)
   */
  function formatDateForS4HANA(dateString) {
    if (!dateString) {
      // Default to today + 7 days for delivery
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      return futureDate.toISOString().split('T')[0];
    }
    
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        throw new Error('Invalid date');
      }
      return date.toISOString().split('T')[0];
    } catch (e) {
      console.error('Date formatting error:', e);
      return new Date().toISOString().split('T')[0];
    }
  }
});