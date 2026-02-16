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
      
      console.log('Document AI Input:', JSON.stringify(extractionData, null, 2));
      
      if (!extractionData?.extraction?.headerFields) {
        throw new Error('Invalid extraction data structure');
      }
      
      // Map Document AI format to internal format
      const headerData = mapHeaderFields(extractionData.extraction.headerFields);
      const lineItems = mapLineItems(extractionData.extraction.lineItems);
      
      console.log('Mapped Header:', JSON.stringify(headerData, null, 2));
      console.log('Mapped Line Items:', JSON.stringify(lineItems, null, 2));
      
      // Validate
      validateBeforeS4HANA(headerData, lineItems);
      
      // Create Sales Order
      console.log('Creating S/4HANA Sales Order...');
      const salesOrderNumber = await createSalesOrderInS4HANA(headerData, lineItems);
      
      console.log('✅ Sales Order created:', salesOrderNumber);
      
      return {
        salesOrderNumber: salesOrderNumber,
        message: `Sales Order ${salesOrderNumber} created successfully from PO ${headerData.documentNumber}`,
        success: true
      };
      
    } catch (error) {
      console.error('❌ Error:', error.message);
      console.error('Stack:', error.stack);
      
      return {
        salesOrderNumber: null,
        message: `Failed: ${error.message}`,
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
      
      if (!extractionData?.extraction?.headerFields) {
        errors.push('Missing header fields');
      }
      
      if (!extractionData?.extraction?.lineItems || extractionData.extraction.lineItems.length === 0) {
        errors.push('Missing line items');
      }
      
      if (extractionData?.extraction?.headerFields) {
        const headerData = mapHeaderFields(extractionData.extraction.headerFields);
        
        if (!headerData.receiverId) {
          errors.push('Missing customer number (receiverId)');
        }
        
        if (!headerData.documentNumber) {
          errors.push('Missing PO number');
        }
      }
      
      if (extractionData?.extraction?.lineItems) {
        const lineItems = mapLineItems(extractionData.extraction.lineItems);
        
        lineItems.forEach((item, i) => {
          if (!item.customerMaterialNumber && !item.materialNumber) {
            errors.push(`Line ${i+1}: Missing material`);
          }
          if (!item.quantity || item.quantity <= 0) {
            errors.push(`Line ${i+1}: Invalid quantity`);
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
            data.senderName = field.value;
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
   * Validate data before S/4HANA call
   */
  function validateBeforeS4HANA(headerData, lineItems) {
    const errors = [];
    
    if (!headerData.receiverId) {
      errors.push('Customer number (receiverId) is required');
    }
    
    if (!headerData.documentNumber) {
      errors.push('PO number (documentNumber) is required');
    }
    
    if (!lineItems || lineItems.length === 0) {
      errors.push('At least one line item is required');
    }
    
    lineItems.forEach((item, i) => {
      if (!item.customerMaterialNumber && !item.materialNumber) {
        errors.push(`Line ${i+1}: Material number is required`);
      }
      if (!item.quantity || item.quantity <= 0) {
        errors.push(`Line ${i+1}: Valid quantity is required`);
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
    // Configuration from environment variables
    const CONFIG = {
      salesOrg: process.env.S4HANA_SALES_ORG || "D106",
      distChannel: process.env.S4HANA_DIST_CHANNEL || "02",
      division: process.env.S4HANA_DIVISION || "00",
      soType: process.env.S4HANA_SO_TYPE || "1SDS",
      paymentTerms: process.env.S4HANA_PAYMENT_TERMS || "Z000",
      plant: process.env.S4HANA_PLANT || "DODY"
    };
    
    // Customer number directly from PDF (no mapping needed)
    const customerNumber = headerData.receiverId;
    
    console.log(`Using customer number from PDF: ${customerNumber}`);
    
    // Parse address from shipToAddress field
    const address = parseAddress(headerData.shipToAddress);
    
    // Build S/4HANA Sales Order payload
    const payload = {
      SalesOrderType: CONFIG.soType,
      CustomerPaymentTerms: CONFIG.paymentTerms,
      SalesOrganization: CONFIG.salesOrg,
      DistributionChannel: CONFIG.distChannel,
      OrganizationDivision: CONFIG.division,
      
      // Dates
      CustomerPurchaseOrderDate: formatDateTime(headerData.documentDate),
      PurchaseOrderByCustomer: headerData.documentNumber,
      
      // Customer (directly from PDF)
      SoldToParty: customerNumber,
      
      // Partner Functions (WE=Ship-to, RE=Bill-to)
      to_Partner: [
        {
          PartnerFunction: "WE",
          Customer: customerNumber,
          to_Address: [{
            OrganizationName1: address.name || headerData.senderName || "",
            Country: "AE",
            Region: "",
            CityName: address.city || "Dubai",
            StreetName: address.street || "",
            StreetPrefixName1: address.streetPrefix || "",
            EmailAddress: address.email || "",
            PhoneNumber: address.phone || "",
            MobileNumber: address.mobile || address.phone || ""
          }]
        },
        {
          PartnerFunction: "RE",
          Customer: customerNumber,
          to_Address: [{
            OrganizationName1: address.name || headerData.senderName || "",
            Country: "AE",
            Region: "",
            CityName: address.city || "Dubai",
            StreetName: address.street || "",
            StreetPrefixName1: address.streetPrefix || "",
            EmailAddress: address.email || "",
            PhoneNumber: address.phone || "",
            MobileNumber: address.mobile || address.phone || ""
          }]
        }
      ],
      
      // Line items
      to_Item: lineItems.map((item, index) => {
        const linePayload = {
          SalesOrderItem: String(index + 1),
          
          // Material number directly from PDF (no mapping needed)
          MaterialByCustomer: item.customerMaterialNumber || item.materialNumber,
          
          ProductionPlant: CONFIG.plant,
          RequestedQuantity: String(item.quantity || 1)
        };
        
        // Add pricing elements if available
        const pricingElements = [];
        
        // Base price (ZMAN)
        if (item.unitPrice) {
          pricingElements.push({
            ConditionType: "ZMAN",
            ConditionRateValue: String(item.unitPrice),
            ConditionQuantityUnit: item.unitOfMeasure || "EA",
            ConditionQuantity: "1",
            ConditionCurrency: headerData.currencyCode || "AED"
          });
        }
        
        // Discount (ZRDV)
        if (item.discountValue) {
          pricingElements.push({
            ConditionType: "ZRDV",
            ConditionRateValue: String(item.discountValue),
            ConditionQuantityUnit: item.unitOfMeasure || "EA",
            ConditionQuantity: "1",
            ConditionCurrency: headerData.currencyCode || "AED"
          });
        }
        
        // VAT (ZVAT)
        if (item.vatValue) {
          pricingElements.push({
            ConditionType: "ZVAT",
            ConditionRateValue: String(item.vatValue),
            ConditionQuantityUnit: item.unitOfMeasure || "EA",
            ConditionQuantity: "1",
            ConditionCurrency: headerData.currencyCode || "AED"
          });
        }
        
        if (pricingElements.length > 0) {
          linePayload.to_PricingElement = pricingElements;
        }
        
        return linePayload;
      })
    };
    
    console.log('S/4HANA Sales Order Payload:', JSON.stringify(payload, null, 2));
    
    try {
      // Call S/4HANA API via handheldterminal_cap destination
      const response = await executeHttpRequest(
        { destinationName: 'handheldterminal_cap' },
        {
          method: 'POST',
          url: '/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder',
          data: payload,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 60000
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
      let errorMsg = 'Unknown error';
      
      if (error.response?.data?.error?.message?.value) {
        errorMsg = error.response.data.error.message.value;
      } else if (error.response?.data?.error?.innererror?.errordetails) {
        errorMsg = error.response.data.error.innererror.errordetails
          .map(d => d.message).join('; ');
      } else if (error.message) {
        errorMsg = error.message;
      }
      
      throw new Error(`S/4HANA Sales Order creation failed: ${errorMsg}`);
    }
  }
  
  /**
   * Parse address string from Document AI
   * Example: "Sidra Village, Villa 39, Umm Suqeim 2, Dubai"
   */
  function parseAddress(addressString) {
    if (!addressString) {
      return {
        name: "",
        street: "",
        streetPrefix: "",
        city: "Dubai",
        email: "",
        phone: "",
        mobile: ""
      };
    }
    
    // Simple comma-separated parsing
    const parts = addressString.split(',').map(p => p.trim());
    
    return {
      name: parts[0] || "",
      street: parts[1] || "",
      streetPrefix: parts[2] || "",
      city: parts[3] || "Dubai",
      email: "",
      phone: "",
      mobile: ""
    };
  }
  
  /**
   * Format datetime for S/4HANA (ISO 8601)
   */
  function formatDateTime(dateString) {
    if (!dateString) {
      return new Date().toISOString();
    }
    
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        throw new Error('Invalid date');
      }
      return date.toISOString();
    } catch (e) {
      console.error('DateTime formatting error:', e);
      return new Date().toISOString();
    }
  }
});