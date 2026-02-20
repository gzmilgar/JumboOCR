const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

module.exports = cds.service.impl(async function() {

  /**
   * Generic Sales Order creation
   * 
   * IMPORTANT: Caller MUST provide ALL required fields in the payload.
   * No default values are applied by the service.
   * Each company's mapping (Sephora, Noon, Geant, etc.) is responsible
   * for providing the complete S/4HANA payload including:
   *   - SalesOrderType (1SSR, 1SHD, OR, etc.)
   *   - SalesOrganization (D106, etc.)
   *   - DistributionChannel (08, 02, etc.)
   *   - OrganizationDivision (00, etc.)
   *   - SoldToParty
   *   - to_Item with Material, Qty, Pricing
   *   - to_Partner (WE, RE, etc.)
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

      console.log('Sales Order Payload:', JSON.stringify(soPayload, null, 2));

      // -----------------------------------------------------------
      // Validate required HEADER fields
      // -----------------------------------------------------------
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

      // -----------------------------------------------------------
      // Validate ITEM fields
      // -----------------------------------------------------------
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
        // Default UoM only if not provided
        if (!item.RequestedQuantityUnit) {
          item.RequestedQuantityUnit = 'EA';
        }
      });

      // -----------------------------------------------------------
      // Log summary
      // -----------------------------------------------------------
      console.log('--- SO Summary ---');
      console.log('  Type:', soPayload.SalesOrderType);
      console.log('  Sales Org:', soPayload.SalesOrganization);
      console.log('  Dist Ch:', soPayload.DistributionChannel);
      console.log('  Division:', soPayload.OrganizationDivision);
      console.log('  Sold-to:', soPayload.SoldToParty);
      console.log('  PO#:', soPayload.PurchaseOrderByCustomer || 'N/A');
      console.log('  Currency:', soPayload.TransactionCurrency || 'N/A');
      console.log('  Items:', soPayload.to_Item.length);
      console.log('--------

      // -----------------------------------------------------------
      // Call S/4HANA API via QS4_HTTPS destination
      // -----------------------------------------------------------
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

      console.log('Sales Order created:', salesOrder);

      return {
        salesOrderNumber: salesOrder,
        message: 'Sales Order ' + salesOrder + ' created successfully',
        success: true
      };

    } catch (error) {
      console.error('Error:', error.message);

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
