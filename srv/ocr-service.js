const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

module.exports = cds.service.impl(async function() {

  /**
   * Generic Sales Order creation
   * Input: JSON string with S/4HANA Sales Order format
   * Source can be Excel (Sephora), PDF (Carrefour), or any other format
   * The caller is responsible for mapping their data to S/4HANA format before calling this action
   */
  this.on('createSalesOrder', async (req) => {
    try {
      console.log('=== createSalesOrder called ===');
      console.log('Raw input:', JSON.stringify(req.data));

      // Parse payload
      let soPayload;
      if (typeof req.data.payload === 'string') {
        soPayload = JSON.parse(req.data.payload);
      } else {
        soPayload = req.data.payload;
      }

      // Boş alanları environment variable'lardan doldur (manifest.yml'de tanımlı)
      if (!soPayload.SalesOrderType) soPayload.SalesOrderType = process.env.S4HANA_SO_TYPE || '';
      if (!soPayload.SalesOrganization) soPayload.SalesOrganization = process.env.S4HANA_SALES_ORG || '';
      if (!soPayload.DistributionChannel) soPayload.DistributionChannel = process.env.S4HANA_DIST_CHANNEL || '';
      if (!soPayload.OrganizationDivision) soPayload.OrganizationDivision = process.env.S4HANA_DIVISION || '';
      if (!soPayload.CustomerPaymentTerms) soPayload.CustomerPaymentTerms = process.env.S4HANA_PAYMENT_TERMS || '';

      // Item seviyesinde default plant uygula
      if (soPayload.to_Item) {
        soPayload.to_Item.forEach(item => {
          if (!item.ProductionPlant) item.ProductionPlant = process.env.S4HANA_PLANT || '';
        });
      }

      console.log('Sales Order Payload (after defaults):', JSON.stringify(soPayload, null, 2));

      // Validate required fields
      if (!soPayload.SalesOrderType) {
        throw new Error('Missing SalesOrderType - set S4HANA_SO_TYPE env variable');
      }
      if (!soPayload.SoldToParty) {
        throw new Error('Missing SoldToParty (customer)');
      }
      if (!soPayload.to_Item || soPayload.to_Item.length === 0) {
        throw new Error('Missing line items (to_Item)');
      }

      // Call S/4HANA API via DS4_HTTPS_110 destination (Cloud Connector)
      console.log('Creating S/4HANA Sales Order...');
      const response = await executeHttpRequest(
        { destinationName: 'DS4_HTTPS_110' },
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

      // Parse OData v2 response
      const salesOrder = response.data?.d?.SalesOrder;

      if (!salesOrder) {
        throw new Error('No SalesOrder number in S/4HANA response');
      }

      console.log('Sales Order created:', salesOrder);

      return {
        salesOrderNumber: salesOrder,
        message: 'Sales Order ' + salesOrder + ' created successfully',
        success: true
      };

    } catch (error) {
      console.error('Error:', error.message);

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

      return {
        salesOrderNumber: null,
        message: 'Failed: ' + errorMsg,
        success: false
      };
    }
  });
});
