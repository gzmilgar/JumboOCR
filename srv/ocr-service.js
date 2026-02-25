const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

module.exports = cds.service.impl(async function() {

  this.on('createSalesOrder', async (req) => {
    try {
      console.log('=== createSalesOrder called ===');
      console.log('Raw input:', JSON.stringify(req.data));

      let soPayload;
      if (typeof req.data.payload === 'string') {
        soPayload = JSON.parse(req.data.payload);
      } else {
        soPayload = req.data.payload;
      }

      console.log('Sales Order Payload:', JSON.stringify(soPayload, null, 2));

      const requiredFields = [
        'SalesOrderType',
        'SalesOrganization',
        'DistributionChannel',
        'OrganizationDivision',
        'SoldToParty'
      ];

      const missing = requiredFields.filter(f => !soPayload[f]);
      if (missing.length > 0) {
        throw new Error('Missing required header fields: ' + missing.join(', '));
      }

      if (!soPayload.to_Item || soPayload.to_Item.length === 0) {
        throw new Error('Missing line items (to_Item)');
      }

      soPayload.to_Item.forEach((item, idx) => {
        const itemNo = item.SalesOrderItem || ((idx + 1) * 10);
        if (!item.Material) {
          throw new Error('Item ' + itemNo + ': Missing Material');
        }
        if (!item.RequestedQuantity || Number(item.RequestedQuantity) <= 0) {
          throw new Error('Item ' + itemNo + ': Missing or invalid RequestedQuantity');
        }
        if (!item.RequestedQuantityUnit) {
          item.RequestedQuantityUnit = 'EA';
        }
      });

      console.log('=== SO Summary ===');
      console.log('  Type: ' + soPayload.SalesOrderType);
      console.log('  Sales Org: ' + soPayload.SalesOrganization);
      console.log('  Dist Ch: ' + soPayload.DistributionChannel);
      console.log('  Division: ' + soPayload.OrganizationDivision);
      console.log('  Sold to: ' + soPayload.SoldToParty);
      console.log('  PO#: ' + (soPayload.PurchaseOrderByCustomer || 'N/A'));
      console.log('  Currency: ' + (soPayload.TransactionCurrency || 'N/A'));
      console.log('  Items: ' + soPayload.to_Item.length);
      console.log('==================');

      console.log('Creating S/4HANA Sales Order...');
      const response = await executeHttpRequest(
        { destinationName: 'QS4_HTTPS' },
        {
          method: 'POST',
          url: '/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder',
          data: soPayload,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 60000
        }
      );

      console.log('S/4HANA Response:', JSON.stringify(response.data, null, 2));

      const salesOrder = response.data?.d?.SalesOrder;

      if (!salesOrder) {
        throw new Error('No SalesOrder number in S/4HANA response');
      }

      console.log('Sales Order created: ' + salesOrder);

      return {
        salesOrderNumber: salesOrder,
        message: 'Sales Order ' + salesOrder + ' created successfully',
        success: true
      };

    } catch (error) {
      console.error('Error: ' + error.message);

      let errorMsg = 'Unknown error';
      if (error.response?.data?.error?.message?.value) {
        errorMsg = error.response.data.error.message.value;
      } else if (error.response?.data?.error?.innererror?.errordetails) {
        errorMsg = error.response.data.error.innererror.errordetails
          .map(d => d.message).join('; ');
      } else if (error.message) {
        errorMsg = error.message;
      }

      return {
        salesOrderNumber: null,
        message: 'Failed: ' + errorMsg,
        success: false
      };
    }
  });

  this.on('lookupProducts', async (req) => {
    try {
      console.log('=== lookupProducts called ===');

      let idArray;
      if (typeof req.data.identifiers === 'string') {
        idArray = JSON.parse(req.data.identifiers);
      } else {
        idArray = req.data.identifiers;
      }

      if (!idArray || idArray.length === 0) {
        throw new Error('Empty identifier list');
      }

      const lookupType = (req.data.lookupType || 'ean').toLowerCase();
      console.log('Lookup type: ' + lookupType + ', count: ' + idArray.length);

      let url;
      let sourceField;
      let productField;

      if (lookupType === 'model') {
        const filterParts = idArray.map(id => "ProductDescription eq '" + String(id) + "'");
        const filterStr = filterParts.join(' or ');
        url = "/sap/opu/odata/sap/API_PRODUCT_SRV/A_ProductDescription"
            + "?$filter=" + encodeURIComponent(filterStr)
            + "&$select=Product,ProductDescription"
            + "&$format=json";
        sourceField = 'ProductDescription';
        productField = 'Product';
      } else {
        const filterParts = idArray.map(id => "ProductStandardID eq '" + String(id) + "'");
        const filterStr = filterParts.join(' or ');
        url = "/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product"
            + "?$filter=" + encodeURIComponent(filterStr)
            + "&$select=Product,ProductStandardID"
            + "&$format=json";
        sourceField = 'ProductStandardID';
        productField = 'Product';
      }

      console.log('Calling API_PRODUCT_SRV (' + lookupType + ')...');
      const response = await executeHttpRequest(
        { destinationName: 'QS4_HTTPS' },
        {
          method: 'GET',
          url: url,
          headers: { 'Accept': 'application/json' },
          timeout: 30000
        }
      );

      const results = response.data?.d?.results || [];
      console.log('Found ' + results.length + ' products');

      const mapping = {};
      results.forEach(r => {
        mapping[r[sourceField]] = r[productField];
      });

      const unmapped = idArray.filter(id => !mapping[String(id)]);
      if (unmapped.length > 0) {
        console.log('WARNING: Unmapped: ' + unmapped.join(', '));
      }

      const allFound = results.length === idArray.length;//aranan satır sayısı ile bulunan satır sayısı eşleşmez ise hata donmeli süreç devam etmemeli

      return {
        products: JSON.stringify(mapping),
        success: allFound,
        message: 'Found ' + results.length + ' of ' + idArray.length + ' products (' + lookupType + ')' + (!allFound ? '. Missing: ' + unmapped.join(', ') : '')
      };

    } catch (error) {
      console.error('lookupProducts Error: ' + error.message);

      let errorMsg = 'Unknown error';
      if (error.response?.data?.error?.message?.value) {
        errorMsg = error.response.data.error.message.value;
      } else if (error.message) {
        errorMsg = error.message;
      }

      return {
        products: '{}',
        success: false,
        message: 'Failed: ' + errorMsg
      };
    }
  });

});
