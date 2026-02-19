const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

module.exports = cds.service.impl(async function() {

  this.on('createSalesOrder', async (req) => {
    try {
      let soPayload;
      if (typeof req.data.payload === 'string') {
        soPayload = JSON.parse(req.data.payload);
      } else {
        soPayload = req.data.payload;
      }

      // Validate
      if (!soPayload.SalesOrderType) throw new Error('Missing SalesOrderType');
      if (!soPayload.SoldToParty) throw new Error('Missing SoldToParty');
      if (!soPayload.to_Item || soPayload.to_Item.length === 0) throw new Error('Missing to_Item');

      // S/4HANA call via Cloud Connector
      const response = await executeHttpRequest(
        { destinationName: 'DS4_HTTPS_110' },
        {
          method: 'POST',
          url: '/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder',
          data: soPayload,
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          timeout: 60000
        }
      );

      const salesOrder = response.data?.d?.SalesOrder;
      return {
        salesOrderNumber: salesOrder,
        message: 'Sales Order ' + salesOrder + ' created successfully',
        success: true
      };
    } catch (error) {
      let errorMsg = error.response?.data?.error?.message?.value
        || error.response?.data?.error?.innererror?.errordetails?.map(d => d.message).join('; ')
        || error.message;
      return { salesOrderNumber: null, message: 'Failed: ' + errorMsg, success: false };
    }
  });
});
