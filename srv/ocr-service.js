// srv/ocr-service.js
const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

var OCR_BASE = '/sap/opu/odata4/sap/zsdocr_sb_log_o4/srvd/sap/zsd_ocr_log_srv/0001/';

function statusCriticality(status) {
    switch ((status || '').toUpperCase()) {
        case 'SUCCESS':  return 3; // Positive (green)
        case 'FAILED':   return 1; // Negative (red)
        case 'RETRYING': return 2; // Critical (orange)
        case 'PENDING':  return 2; // Critical (orange)
        default:         return 0; // None (neutral)
    }
}

module.exports = class extends cds.ApplicationService { async init() {

    // ============================================================
    // OCRLogs READ - super.init() ÖNCE (liste + tekil kayıt)
    // ============================================================
    this.on('READ', 'OCRLogs', async (req) => {
        try {
            // Extract UUID from multiple possible locations
            var uuid = null;

            // 1) req.params (navigation: OCRLogs('uuid'))
            if (req.params && req.params.length > 0) {
                var p = req.params[0];
                uuid = (typeof p === 'object') ? (p.Uuid || p.UUID || p.uuid) : p;
            }

            // 2) req.data (sometimes CAP puts key here)
            if (!uuid && req.data && req.data.Uuid) {
                uuid = req.data.Uuid;
            }

            // 3) WHERE clause
            if (!uuid) {
                uuid = extractKeyFromWhere(req.query?.SELECT?.where, 'Uuid');
            }

            console.log('OCRLogs READ: uuid=' + (uuid || 'null') + ' params=' + JSON.stringify(req.params));

if (uuid) {
    const r = await s4GetPOLog(uuid);
    return [{
        Uuid: r.uuid || '', ProcessName: r.processName || '',
        PdfName: r.pdfName || '', MailSubject: '',
        PurchaseOrder: r.purchaseOrder || '', DeliveryDate: r.deliveryDate || '',
        DocumentDate: r.documentDate || '', ReceiverId: r.receiverId || '',
        CurrencyCode: r.currencyCode || '', NetAmount: parseFloat(r.netAmount) || 0,
        GrossAmount: parseFloat(r.grossAmount) || 0, TotalVat: r.totalVat || '',
        Discount: parseFloat(r.discount) || 0, DeliveryAdress: r.deliveryAdress || '',
        VendorAdress: r.vendorAdress || '', Status: r.status || '',
        StatusCriticality: statusCriticality(r.status),
        SalesOrderNumber: r.salesOrderNumber || '', ErrorMessage: r.errorMessage || '',
        MissingBarcodes: r.missingBarcodes || '', ItemCount: r.itemCount || 0,
        CreatedAt: r.createdAt || '', UpdatedAt: r.updatedAt || '',
        Items: (r.items || []).map(item => ({
            HeaderId: r.uuid || '',
            ItemNumber: item.ItemNumber || '',
            Barcode: item.Barcode || '',
            Description: item.Description || '',
            MaterialNumber: item.MaterialNumber || '',
            Unit: item.Unit || '',
            Quantity: item.Quantity || 0,
            UnitPrice: item.UnitPrice || 0,
            Discount: item.Discount || 0
        }))
    }];
}
 else {
                const response = await executeHttpRequest(
                    { destinationName: 'QS4_HTTPS' },
                    { method: 'GET', url: OCR_BASE + 'OCRLogHead?$orderby=CreatedAt desc&$top=200',
                      headers: { 'Accept': 'application/json' }, timeout: 30000 }
                );
                return (response.data?.value || []).map(r => ({
                    Uuid: r.Uuid || '', ProcessName: r.ProcessName || '',
                    PdfName: r.PdfName || '', MailSubject: r.MailSubject || '',
                    PurchaseOrder: r.PurchaseOrder || '', DeliveryDate: r.DeliveryDate || '',
                    DocumentDate: r.DocumentDate || '', ReceiverId: r.ReceiverId || '',
                    CurrencyCode: r.CurrencyCode || '', NetAmount: r.NetAmount || 0,
                    GrossAmount: r.GrossAmount || 0, TotalVat: r.TotalVat || '',
                    Discount: r.Discount || 0, DeliveryAdress: r.DeliveryAdress || '',
                    VendorAdress: r.VendorAdress || '', Status: r.Status || '',
                    StatusCriticality: statusCriticality(r.Status),
                    SalesOrderNumber: r.SalesOrderNumber || '', ErrorMessage: r.ErrorMessage || '',
                    MissingBarcodes: r.MissingBarcodes || '', ItemCount: r.ItemCount || 0,
                    CreatedAt: r.CreatedAt || '', UpdatedAt: r.UpdatedAt || ''
                }));
            }
        } catch (e) {
            console.error('OCRLogs READ error:', e.message);
            return [];
        }
    });

    // ============================================================
    // OCRItems READ - super.init() ÖNCE
    // ============================================================
this.on('READ', 'OCRItems', async (req) => {
    try {
        var headerId = null;
        if (req.params && req.params[0]) {
            headerId = typeof req.params[0] === 'object'
                ? req.params[0].HeaderId || req.params[0].Uuid
                : req.params[0];
        }
        if (!headerId) headerId = extractKeyFromWhere(req.query?.SELECT?.where, 'HeaderId');
        if (!headerId) return [];

        var url = OCR_BASE + "OCRLogHead(" + headerId + ")?$expand=_Items";
        console.log('OCRItems READ: URL=' + url);

        var response = await executeHttpRequest(
            { destinationName: 'QS4_HTTPS' },
            { method: 'GET', url: url, headers: { 'Accept': 'application/json' }, timeout: 30000 }
        );

        var rawItems = response.data?._Items || [];
        console.log('OCRItems READ: count=' + rawItems.length);

        return rawItems.map(function(item) {
            return {
                HeaderId:       item.HeaderId      || headerId,
                ItemNumber:     item.ItemNumber     || '',
                Barcode:        item.Barcode        || '',
                Description:    item.Description    || '',
                MaterialNumber: item.MaterialNumber || '',
                Unit:           item.Unit           || 'EA',
                Quantity:       parseFloat(item.Quantity)  || 0,
                UnitPrice:      parseFloat(item.UnitPrice) || 0,
                Discount:       parseFloat(item.Discount)  || 0
            };
        });

    } catch (e) {
        console.error('OCRItems READ error: ' + e.message);
        return [];
    }
});
    // UPDATE - super.init() ÖNCE
this.on('UPDATE', 'OCRLogs', async (req) => {
    let uuid = req.params?.[0]?.Uuid 
            || req.params?.[0] 
            || req.data?.Uuid;
    
    console.log('UPDATE OCRLogs: uuid=' + uuid);
    console.log('UPDATE OCRLogs: params=' + JSON.stringify(req.params));
    console.log('UPDATE OCRLogs: data=' + JSON.stringify(req.data));
    
    if (!uuid) {
        req.error(400, 'UUID is required for update');
        return;
    }
    
    const d = req.data;
    
    try {
        // ── 1. HEADER PATCH ──────────────────────────────────────
        const patchBody = {};
        if (d.PurchaseOrder    !== undefined) patchBody.PurchaseOrder    = d.PurchaseOrder    || '';
        if (d.DeliveryDate     !== undefined) patchBody.DeliveryDate     = d.DeliveryDate     || null;
        if (d.DocumentDate     !== undefined) patchBody.DocumentDate     = d.DocumentDate     || null;
        if (d.ReceiverId       !== undefined) patchBody.ReceiverId       = d.ReceiverId       || '';
        if (d.CurrencyCode     !== undefined) patchBody.CurrencyCode     = d.CurrencyCode     || '';
        if (d.NetAmount        !== undefined) patchBody.NetAmount        = parseFloat(d.NetAmount)   || 0;
        if (d.GrossAmount      !== undefined) patchBody.GrossAmount      = parseFloat(d.GrossAmount) || 0;
        if (d.TotalVat         !== undefined) patchBody.TotalVat         = d.TotalVat         || '';
        if (d.Discount         !== undefined) patchBody.Discount         = parseFloat(d.Discount)    || 0;
        if (d.DeliveryAdress   !== undefined) patchBody.DeliveryAdress   = d.DeliveryAdress   || '';
        if (d.VendorAdress     !== undefined) patchBody.VendorAdress     = d.VendorAdress     || '';
        if (d.Status           !== undefined) patchBody.Status           = d.Status           || '';
        if (d.SalesOrderNumber !== undefined) patchBody.SalesOrderNumber = d.SalesOrderNumber || '';
        if (d.ErrorMessage     !== undefined) patchBody.ErrorMessage     = d.ErrorMessage     || '';
        if (d.MissingBarcodes  !== undefined) patchBody.MissingBarcodes  = d.MissingBarcodes  || '';

        if (Object.keys(patchBody).length > 0) {
            console.log('UPDATE OCRLogs: patchBody=' + JSON.stringify(patchBody));
            await s4Patch('OCRLogHead(' + uuid + ')', patchBody);
            console.log('UPDATE OCRLogs: header PATCH success');
        }

        // ── 2. ITEMS PATCH ───────────────────────────────────────
        const items = d.Items || [];
        console.log('UPDATE OCRLogs: items count=' + items.length);

        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            const rawItemNo    = String(item.ItemNumber || '').trim();
            const paddedItemNo = rawItemNo.padStart(6, '0');

            if (!paddedItemNo || paddedItemNo === '000000') {
                console.warn('UPDATE OCRLogs: item[' + i + '] has no valid ItemNumber, skipping');
                continue;
            }

            const itemPatch = {};
            if (item.Barcode        !== undefined) itemPatch.Barcode        = item.Barcode              || '';
            if (item.Quantity       !== undefined) itemPatch.Quantity       = parseFloat(item.Quantity)  || 0;
            if (item.UnitPrice      !== undefined) itemPatch.UnitPrice      = parseFloat(item.UnitPrice) || 0;
            if (item.Discount       !== undefined) itemPatch.Discount       = parseFloat(item.Discount)  || 0;
            if (item.Description    !== undefined) itemPatch.Description    = item.Description           || '';
            if (item.MaterialNumber !== undefined) itemPatch.MaterialNumber = item.MaterialNumber        || '';
            if (item.Unit           !== undefined) itemPatch.Unit           = item.Unit                  || 'EA';

            if (Object.keys(itemPatch).length > 0) {
                const itemUrl = "OCRLogItem(HeaderId=" + uuid + 
                                ",ItemNumber='" + paddedItemNo + "')";
                console.log('UPDATE OCRLogs: PATCH item URL=' + itemUrl);
                console.log('UPDATE OCRLogs: PATCH item body=' + JSON.stringify(itemPatch));
                await s4Patch(itemUrl, itemPatch);
                console.log('UPDATE OCRLogs: item PATCH success, ItemNumber=' + paddedItemNo);
            }
        }

        // ── 3. GÜNCEL VERİYİ S/4HANA'DAN ÇEK ───────────────────
        console.log('UPDATE OCRLogs: fetching updated data from S/4HANA...');
        const updated = await s4GetPOLog(uuid);
        console.log('UPDATE OCRLogs: fetch success, status=' + updated.status);

        return {
            Uuid:             updated.uuid             || uuid,
            ProcessName:      updated.processName      || d.ProcessName      || '',
            PdfName:          updated.pdfName          || d.PdfName          || '',
            MailSubject:      updated.mailSubject      || d.MailSubject      || '',
            PurchaseOrder:    updated.purchaseOrder    || d.PurchaseOrder    || '',
            DeliveryDate:     updated.deliveryDate     || d.DeliveryDate     || '',
            DocumentDate:     updated.documentDate     || d.DocumentDate     || '',
            ReceiverId:       updated.receiverId       || d.ReceiverId       || '',
            CurrencyCode:     updated.currencyCode     || d.CurrencyCode     || '',
            NetAmount:        parseFloat(updated.netAmount)   || d.NetAmount   || 0,
            GrossAmount:      parseFloat(updated.grossAmount) || d.GrossAmount || 0,
            TotalVat:         updated.totalVat         || d.TotalVat         || '',
            Discount:         parseFloat(updated.discount)    || d.Discount   || 0,
            DeliveryAdress:   updated.deliveryAdress   || d.DeliveryAdress   || '',
            VendorAdress:     updated.vendorAdress     || d.VendorAdress     || '',
            Status:           updated.status           || d.Status           || '',
            SalesOrderNumber: updated.salesOrderNumber || d.SalesOrderNumber || '',
            ErrorMessage:     updated.errorMessage     || d.ErrorMessage     || '',
            MissingBarcodes:  updated.missingBarcodes  || d.MissingBarcodes  || '',
            ItemCount:        updated.itemCount        || d.ItemCount        || 0,
            CreatedAt:        updated.createdAt        || d.CreatedAt        || '',
            UpdatedAt:        updated.updatedAt        || d.UpdatedAt        || '',
            Items: (updated.items || []).map(item => ({
                HeaderId:       item.HeaderId       || uuid,
                ItemNumber:     item.ItemNumber      || '',
                Barcode:        item.Barcode         || '',
                Description:    item.Description     || '',
                MaterialNumber: item.MaterialNumber  || '',
                Unit:           item.Unit            || 'EA',
                Quantity:       parseFloat(item.Quantity)  || 0,
                UnitPrice:      parseFloat(item.UnitPrice) || 0,
                Discount:       parseFloat(item.Discount)  || 0
            }))
        };

    } catch (e) {
        console.error('UPDATE OCRLogs error: ' + e.message);
        console.error('UPDATE OCRLogs stack: ' + e.stack);
        req.error(500, 'Update failed: ' + e.message);
    }
});

this.on('UPDATE', 'OCRItems', async (req) => {
    const hId = req.params?.[0]?.HeaderId;
    const iNo = req.params?.[0]?.ItemNumber;
    const d = req.data;
    try {
        var sapUuid = hId;
        await s4Patch("OCRLogItem(HeaderId=" + sapUuid + ",ItemNumber='" + iNo + "')", {
            Barcode:   d.Barcode,
            Quantity:  d.Quantity,
            UnitPrice: d.UnitPrice,
            Discount:  d.Discount
        });
    } catch(e) {
        console.error('UPDATE OCRItems error:', e.message);
    }
    return req.data;
});

    // ============================================================
    // triggerLog - Bound action on OCRLogs
    // ============================================================
    this.on('triggerLog', 'OCRLogs', async (req) => {
        var uuid = req.params?.[0]?.Uuid || req.params?.[0];
        console.log('=== triggerLog called: uuid=' + uuid + ' ===');
        console.log('triggerLog req.params:', JSON.stringify(req.params));
        try {
            if (!uuid) return { success: false, message: 'UUID is required', salesOrder: '' };
            var logEntry = await s4GetPOLog(uuid);
            if (!logEntry) {
                console.log('triggerLog: POLog not found for uuid=' + uuid);
                return { success: false, message: 'POLog not found: ' + uuid, salesOrder: '' };
            }
            console.log('triggerLog: processName=' + logEntry.processName + ' PO=' + logEntry.purchaseOrder + ' items=' + logEntry.items.length);

            var stsaResult = await _lookupShipToAndSalesArea(logEntry.processName);
            console.log('triggerLog: STSA success=' + stsaResult.success + ' msg=' + stsaResult.message);
            var stsa = { shipToPartners: stsaResult.shipToPartners, salesAreaMap: stsaResult.salesAreaMap };
            var minData = {
                purchaseOrder: logEntry.purchaseOrder, deliveryDate: logEntry.deliveryDate,
                documentDate: logEntry.documentDate, receiverId: logEntry.receiverId,
                deliveryAdress: logEntry.deliveryAdress, vendorAdress: logEntry.vendorAdress, taxId: logEntry.taxId,
                lineItems: logEntry.items.map(function(i) {
                    return { barcode: i.Barcode||'', quantity: String(i.Quantity||''), unitPrice: String(i.UnitPrice||''),
                             discount: String(i.Discount||''), itemNumber: i.ItemNumber||'', description: i.Description||'',
                             materialNumber: i.MaterialNumber||'' };
                })
            };
            var data = wrapForBuildPayload(minData);
            await autoUpdatePOLog(uuid, 'RETRYING', '', '', 0, '');
            console.log('triggerLog: calling _processSalesOrder...');
            var result = await _processSalesOrder(data, stsa, logEntry.processName);
            console.log('triggerLog: result success=' + result.success + ' SO=' + result.salesOrderNumber + ' msg=' + result.message);
            await autoUpdatePOLog(uuid, result.success?'SUCCESS':'FAILED',
                result.salesOrderNumber||'', result.success?'':(result.message||''),
                result.itemCount||0, result.missingBarcodes||'');
            return { success: result.success, message: result.message||'Sales order creation failed', salesOrder: result.salesOrderNumber||'' };
        } catch (e) {
            console.error('triggerLog error: ' + e.message);
            console.error('triggerLog stack: ' + e.stack);
            // Extract detailed S/4HANA error message
            var errorMsg = e.message || 'Unknown error';
            if (e.response?.data?.error?.message?.value) {
                errorMsg = e.response.data.error.message.value;
            } else if (e.response?.data?.error?.innererror?.errordetails) {
                errorMsg = e.response.data.error.innererror.errordetails
                    .map(function (d) { return d.message; }).join('; ');
            } else if (e.response?.data?.error?.message) {
                errorMsg = typeof e.response.data.error.message === 'string'
                    ? e.response.data.error.message
                    : JSON.stringify(e.response.data.error.message);
            }
            console.error('triggerLog errorMsg: ' + errorMsg);
            try { await autoUpdatePOLog(uuid, 'FAILED', '', errorMsg, 0, ''); } catch (e2) {}
            return { success: false, message: errorMsg, salesOrder: '' };
        }
    });

    // ============================================================
    // 1) lookupShipToAndSalesArea
    // ============================================================
    this.on('lookupShipToAndSalesArea', async (req) => {
        try {
            console.log('=== lookupShipToAndSalesArea called ===');
            var ocrCompany = req.data.ocrCompany;
            if (!ocrCompany) {
                throw new Error('ocrCompany parameter is required');
            }
            console.log('Company: ' + ocrCompany);

            var basePath = "/sap/opu/odata4/sap/zsdocr_sb_shp_prt/srvd/sap/zsdocr_sd_shp_prt/0001";
            var url = basePath + "/Root"
                + "?$expand=_ShipToPartner($filter=" + encodeURIComponent("Company eq '" + ocrCompany + "'") + ")"
                + ",_SalesAreaMap"
                + "&$format=json";

            console.log('Calling S/4HANA...');
            var response = await executeHttpRequest(
                { destinationName: 'QS4_HTTPS' },
                {
                    method: 'GET',
                    url: url,
                    headers: { 'Accept': 'application/json' },
                    timeout: 30000
                }
            );

            var results = response.data?.value || [];
            var shipToResults = [];
            var salesAreaResults = [];
            results.forEach(function (item) {
                if (item._ShipToPartner) {
                    shipToResults = shipToResults.concat(item._ShipToPartner);
                }
                if (item._SalesAreaMap) {
                    salesAreaResults = salesAreaResults.concat(item._SalesAreaMap);
                }
            });

            console.log('ShipToPartner results: ' + shipToResults.length);
            console.log('SalesAreaMap results: ' + salesAreaResults.length);

            if (salesAreaResults.length > 0) {
                console.log('SalesAreaMap SAMPLE keys: ' + Object.keys(salesAreaResults[0]).join(', '));
                console.log('SalesAreaMap SAMPLE data: ' + JSON.stringify(salesAreaResults[0]));
            }

            if (shipToResults.length > 0) {
                console.log('ShipToPartner SAMPLE keys: ' + Object.keys(shipToResults[0]).join(', '));
                console.log('ShipToPartner SAMPLE data: ' + JSON.stringify(shipToResults[0]));
            }

            if (shipToResults.length === 0 && salesAreaResults.length === 0) {
                return {
                    shipToPartners: '[]',
                    salesAreaMap: '[]',
                    success: false,
                    message: 'No data found for: ' + ocrCompany
                };
            }

            return {
                shipToPartners: JSON.stringify(shipToResults),
                salesAreaMap: JSON.stringify(salesAreaResults),
                success: true,
                message: 'ShipTo: ' + shipToResults.length + ' records, SalesArea: ' + salesAreaResults.length + ' records'
            };
        } catch (error) {
            console.error('lookupShipToAndSalesArea Error: ' + error.message);
            var errorMsg = 'Unknown error';
            if (error.response?.data?.error?.message?.value) {
                errorMsg = error.response.data.error.message.value;
            } else if (error.message) {
                errorMsg = error.message;
            }
            return {
                shipToPartners: '[]',
                salesAreaMap: '[]',
                success: false,
                message: 'Failed: ' + errorMsg
            };
        }
    });

    // ============================================================
    // 2) processAndCreateSalesOrder
    // ============================================================
    this.on('processAndCreateSalesOrder', async (req) => {
        var processName = req.data.processName || 'Unknown';
        var logUuid = null;
        try {
            console.log('=== processAndCreateSalesOrder called [' + processName + '] ===');

            var data;
            if (typeof req.data.extractedData === 'string') {
                data = JSON.parse(req.data.extractedData);
            } else {
                data = req.data.extractedData;
            }

            var stsa = {};
            if (req.data.shipToAndSalesArea) {
                if (typeof req.data.shipToAndSalesArea === 'string') {
                    stsa = JSON.parse(req.data.shipToAndSalesArea);
                } else {
                    stsa = req.data.shipToAndSalesArea;
                }
            }

            var minData = extractMinimalData(data);
            logUuid = await autoSavePOLog({
                processName:    processName,
                pdfName:        req.data.pdfName || '',
                mailSubject:    req.data.mailSubject || '',
                purchaseOrder:  minData.purchaseOrder,
                deliveryDate:   minData.deliveryDate,
                documentDate:   minData.documentDate,
                receiverId:     minData.receiverId,
                currencyCode:   minData.currencyCode,
                netAmount:      minData.netAmount,
                grossAmount:    minData.grossAmount,
                totalVat:       minData.totalVAT,
                discount:       minData.discount,
                deliveryAdress: minData.deliveryAdress,
                vendorAdress:   minData.vendorAdress,
                lineItems:      minData.lineItems
            });

            var result = await _processSalesOrder(data, stsa, processName);

            if (logUuid) {
                await autoUpdatePOLog(logUuid,
                    result.success ? 'SUCCESS' : 'FAILED',
                    result.salesOrderNumber || '',
                    result.success ? '' : (result.message || ''),
                    result.itemCount || 0,
                    result.missingBarcodes || '');
            }
            return result;

        } catch (error) {
            console.error('[' + processName + '] ERROR: ' + error.message);
            var errorMsg = 'Unknown error';
            if (error.response?.data?.error?.message?.value) {
                errorMsg = error.response.data.error.message.value;
            } else if (error.response?.data?.error?.innererror?.errordetails) {
                errorMsg = error.response.data.error.innererror.errordetails
                    .map(function (d) { return d.message; }).join('; ');
            } else if (error.message) {
                errorMsg = error.message;
            }
            if (logUuid) await autoUpdatePOLog(logUuid, 'FAILED', '', errorMsg, 0, '');
            return {
                salesOrderNumber: null,
                message: 'Failed: ' + errorMsg,
                success: false,
                itemCount: 0,
                missingBarcodes: ''
            };
        }
    });

    // ============================================================
    // 3) getPOLogs
    // ============================================================
    this.on('getPOLogs', async (req) => {
        try {
            var statusFilter = req.data.statusFilter || '';
            var url = OCR_BASE + 'OCRLogHead'
                + '?$select=Uuid,ProcessName,PurchaseOrder,DeliveryDate,Status,'
                + 'SalesOrderNumber,ErrorMessage,ItemCount,CreatedAt,UpdatedAt'
                + '&$orderby=CreatedAt desc';
            if (statusFilter) {
                url += "&$filter=Status eq '" + statusFilter + "'";
            }
            var response = await executeHttpRequest(
                { destinationName: 'QS4_HTTPS' },
                { method: 'GET', url: url, headers: { 'Accept': 'application/json' }, timeout: 30000 }
            );
            return (response.data?.value || []).map(function (r) {
                return {
                    uuid:             r.Uuid || '',
                    processName:      r.ProcessName || '',
                    purchaseOrder:    r.PurchaseOrder || '',
                    deliveryDate:     r.DeliveryDate || '',
                    status:           r.Status || '',
                    salesOrderNumber: r.SalesOrderNumber || '',
                    errorMessage:     r.ErrorMessage || '',
                    itemCount:        r.ItemCount || 0,
                    createdAt:        r.CreatedAt || '',
                    updatedAt:        r.UpdatedAt || ''
                };
            });
        } catch (error) {
            console.error('getPOLogs Error: ' + error.message);
            return [];
        }
    });

    // ============================================================
    // 5) getPOLog
    // ============================================================
    this.on('getPOLog', async (req) => {
        try {
            var logEntry = await s4GetPOLog(req.data.uuid);
            return {
                uuid:             logEntry.uuid,
                processName:      logEntry.processName,
                pdfName:          logEntry.pdfName,
                purchaseOrder:    logEntry.purchaseOrder,
                deliveryDate:     logEntry.deliveryDate,
                documentDate:     logEntry.documentDate,
                receiverId:       logEntry.receiverId,
                currencyCode:     logEntry.currencyCode,
                netAmount:        logEntry.netAmount,
                grossAmount:      logEntry.grossAmount,
                totalVat:         logEntry.totalVat,
                discount:         logEntry.discount,
                deliveryAdress:   logEntry.deliveryAdress,
                vendorAdress:     logEntry.vendorAdress,
                status:           logEntry.status,
                salesOrderNumber: logEntry.salesOrderNumber,
                errorMessage:     logEntry.errorMessage,
                itemCount:        logEntry.itemCount,
                missingBarcodes:  logEntry.missingBarcodes,
                createdAt:        logEntry.createdAt,
                items:            JSON.stringify(logEntry.items || [])
            };
        } catch (error) {
            console.error('getPOLog Error: ' + error.message);
            throw error;
        }
    });

    // ============================================================
    // 6) updatePOLogData
    // ============================================================
this.on('updatePOLogData', async (req) => {
    try {
        var uuid  = req.data.uuid;
        var hdr   = JSON.parse(req.data.headerData || '{}');
        var items = JSON.parse(req.data.itemsData  || '[]');

        console.log('updatePOLogData: uuid=' + uuid);
        console.log('updatePOLogData: items=' + JSON.stringify(items));

        // ── 1. HEADER PATCH ──────────────────────────────────
        var headerPatch = {};
        if (hdr.purchaseOrder  !== undefined) headerPatch.PurchaseOrder  = hdr.purchaseOrder  || '';
        if (hdr.deliveryDate   !== undefined) headerPatch.DeliveryDate   = hdr.deliveryDate   || null;
        if (hdr.documentDate   !== undefined) headerPatch.DocumentDate   = hdr.documentDate   || null;
        if (hdr.receiverId     !== undefined) headerPatch.ReceiverId     = hdr.receiverId     || '';
        if (hdr.deliveryAdress !== undefined) headerPatch.DeliveryAdress = hdr.deliveryAdress || '';
        if (hdr.vendorAdress   !== undefined) headerPatch.VendorAdress   = hdr.vendorAdress   || '';
        if (hdr.netAmount      !== undefined) headerPatch.NetAmount      = parseFloat(hdr.netAmount)   || 0;
        if (hdr.grossAmount    !== undefined) headerPatch.GrossAmount    = parseFloat(hdr.grossAmount) || 0;
        if (hdr.currencyCode   !== undefined) headerPatch.CurrencyCode   = hdr.currencyCode   || '';

        if (Object.keys(headerPatch).length > 0) {
            console.log('updatePOLogData: header patch=' + JSON.stringify(headerPatch));
            await s4Patch("OCRLogHead(" + uuid + ")", headerPatch);
            console.log('updatePOLogData: header PATCH success');
        }

        // ── 2. ITEMS PATCH ────────────────────────────────────
        for (var i = 0; i < items.length; i++) {
            var item = items[i];

            // ItemNumber normalize → "10" veya "000010" → "000010"
            var rawItemNo    = String(item.itemNumber || item.ItemNumber || '').trim();
            var paddedItemNo = rawItemNo.padStart(6, '0');

            console.log('updatePOLogData: item[' + i + '] rawItemNo=' + rawItemNo + 
                        ' paddedItemNo=' + paddedItemNo);

            if (!paddedItemNo || paddedItemNo === '000000') {
                console.warn('updatePOLogData: item[' + i + '] gecersiz ItemNumber, atlanıyor');
                continue;
            }

            var itemPatch = {};
            if (item.barcode   !== undefined) itemPatch.Barcode    = item.barcode              || '';
            if (item.quantity  !== undefined) itemPatch.Quantity   = parseFloat(item.quantity)  || 0;
            if (item.unitPrice !== undefined) itemPatch.UnitPrice  = parseFloat(item.unitPrice) || 0;
            if (item.discount  !== undefined) itemPatch.Discount   = parseFloat(item.discount)  || 0;

            // camelCase de gelebilir kontrol et
            if (item.Barcode    !== undefined) itemPatch.Barcode   = item.Barcode              || '';
            if (item.Quantity   !== undefined) itemPatch.Quantity  = parseFloat(item.Quantity)  || 0;
            if (item.UnitPrice  !== undefined) itemPatch.UnitPrice = parseFloat(item.UnitPrice) || 0;
            if (item.Discount   !== undefined) itemPatch.Discount  = parseFloat(item.Discount)  || 0;

            if (Object.keys(itemPatch).length > 0) {
                var itemUrl = "OCRLogItem(HeaderId=" + uuid + 
                              ",ItemNumber='" + paddedItemNo + "')";
                console.log('updatePOLogData: PATCH URL=' + itemUrl);
                console.log('updatePOLogData: PATCH body=' + JSON.stringify(itemPatch));
                await s4Patch(itemUrl, itemPatch);
                console.log('updatePOLogData: item PATCH success ItemNumber=' + paddedItemNo);
            }
        }

        // ── 3. GÜNCEL VERİYİ S/4HANA'DAN ÇEK VE DÖNDÜR ──────
        console.log('updatePOLogData: fetching updated data...');
        const updated = await s4GetPOLog(uuid);
        console.log('updatePOLogData: fetch success');

        return {
            success: true,
            message: 'Updated successfully',
            // Güncel header bilgileri
            uuid:             updated.uuid             || uuid,
            purchaseOrder:    updated.purchaseOrder    || '',
            deliveryDate:     updated.deliveryDate     || '',
            documentDate:     updated.documentDate     || '',
            receiverId:       updated.receiverId       || '',
            currencyCode:     updated.currencyCode     || '',
            netAmount:        updated.netAmount        || '0',
            grossAmount:      updated.grossAmount      || '0',
            deliveryAdress:   updated.deliveryAdress   || '',
            vendorAdress:     updated.vendorAdress     || '',
            status:           updated.status           || '',
            salesOrderNumber: updated.salesOrderNumber || '',
            errorMessage:     updated.errorMessage     || '',
            missingBarcodes:  updated.missingBarcodes  || '',
            // Güncel item bilgileri
            items: JSON.stringify((updated.items || []).map(item => ({
                HeaderId:       item.HeaderId       || uuid,
                ItemNumber:     item.ItemNumber      || '',
                Barcode:        item.Barcode         || '',
                Description:    item.Description     || '',
                MaterialNumber: item.MaterialNumber  || '',
                Unit:           item.Unit            || 'EA',
                Quantity:       parseFloat(item.Quantity)  || 0,
                UnitPrice:      parseFloat(item.UnitPrice) || 0,
                Discount:       parseFloat(item.Discount)  || 0
            })))
        };

    } catch (e) {
        console.error('updatePOLogData error: ' + e.message);
        console.error('updatePOLogData stack: ' + e.stack);
        return { success: false, message: e.message };
    }
});
    // ============================================================
    // INTERNAL: _processSalesOrder
    // ============================================================
    async function _processSalesOrder(data, stsa, processName) {
        var salesAreaList = parseJsonField(stsa.salesAreaMap);
        var shipToList = parseJsonField(stsa.shipToPartners);
        var overrides = getProcessOverrides(processName);

        console.log('[' + processName + '] SalesAreaMap count: ' + salesAreaList.length);
        if (salesAreaList.length > 0) {
            console.log('[' + processName + '] SalesAreaMap keys: ' + Object.keys(salesAreaList[0]).join(', '));
            console.log('[' + processName + '] SalesAreaMap[0]: ' + JSON.stringify(salesAreaList[0]));
        }

        console.log('[' + processName + '] ShipToPartner count: ' + shipToList.length);
        if (shipToList.length > 0) {
            console.log('[' + processName + '] ShipToPartner keys: ' + Object.keys(shipToList[0]).join(', '));
        }

        var allowedBukrs = extractAllowedBukrs(salesAreaList);
        console.log('[' + processName + '] Allowed BUKRS from salesAreaMap: [' + allowedBukrs.join(', ') + ']');

        var extracted = extractEansAndTaxId(data);
        var eans = extracted.eans;
        var taxId = extracted.taxId;
        console.log('[' + processName + '] EANs:' + eans.length + ' TaxId:' + taxId);

        var eanProductMap = await lookupProducts(eans);
        console.log('[' + processName + '] Products:' + Object.keys(eanProductMap).length + '/' + eans.length);

        var barcodeReport = checkBarcodes(eans, eanProductMap);
        if (barcodeReport.missing.length > 0) {
            console.log('[' + processName + '] Missing barcodes: ' + barcodeReport.missing.join(', '));
        }

        var payload = await buildPayload(data, eanProductMap, {
            salesAreaList: salesAreaList,
            shipToList: shipToList,
            processName: processName,
            overrides: overrides,
            allowedBukrs: allowedBukrs
        });

        var errors = payload._errors;
        var soldToParty = payload._soldToParty;
        var companyCode = payload._companyCode;
        delete payload._errors;
        delete payload._soldToParty;
        delete payload._companyCode;

        console.log('[' + processName + '] BP Result → SoldTo:' + soldToParty + ' BUKRS:' + companyCode);

        if (!soldToParty) {
            return {
                salesOrderNumber: null,
                message: 'SoldToParty not found. Hatalar: ' + errors.join('; '),
                success: false,
                itemCount: 0,
                missingBarcodes: barcodeReport.missing.join(',')
            };
        }

        console.log('[' + processName + '] Payload: SOType=' + payload.SalesOrderType +
            ' SalesOrg=' + payload.SalesOrganization +
            ' DistCh=' + payload.DistributionChannel +
            ' Div=' + payload.OrganizationDivision +
            ' Items=' + payload.to_Item.length + ' Errors=' + errors.length);

        if (payload.to_Item.length === 0) {
            return {
                salesOrderNumber: null,
                message: 'Geçerli kalem yok. Hatalar: ' + errors.join('; '),
                success: false,
                itemCount: 0,
                missingBarcodes: barcodeReport.missing.join(',')
            };
        }

        var soResult = await createSalesOrder(payload);
        console.log('[' + processName + '] SO created: ' + soResult.salesOrder);

        return {
            salesOrderNumber: soResult.salesOrder,
            message: 'Sales Order ' + soResult.salesOrder + ' created successfully',
            success: true,
            itemCount: payload.to_Item.length,
            missingBarcodes: barcodeReport.missing.join(',')
        };
    }

    // ============================================================
    // INTERNAL: autoSavePOLog → POST to S/4HANA
    // ============================================================
    async function autoSavePOLog(fields) {
        var uuid = require('crypto').randomUUID();
        try {
            var now = new Date().toISOString().slice(0, 19).replace('T', '').replace(/[-:]/g, '');
            var body = {
                Uuid:           uuid,
                ProcessName:    fields.processName || '',
                PdfName:        fields.pdfName || '',
                MailSubject:    fields.mailSubject || '',
                PurchaseOrder:  fields.purchaseOrder || '',
                DeliveryDate:   fields.deliveryDate || null,
                DocumentDate:   fields.documentDate || null,
                ReceiverId:     fields.receiverId || '',
                CurrencyCode:   fields.currencyCode || '',
                NetAmount:      parseFloat(fields.netAmount) || 0,
                GrossAmount:    parseFloat(fields.grossAmount) || 0,
                TotalVat:       fields.totalVat ? String(fields.totalVat) : '000000000',
                Discount:       parseFloat(fields.discount) || 0,
                DeliveryAdress: fields.deliveryAdress || '',
                VendorAdress:   fields.vendorAdress || '',
                Status:         'PENDING',
                CreatedAt:      now,
                UpdatedAt:      now,
                _Items: (fields.lineItems || []).map(function (item, idx) {
                    return {
                        HeaderId:       uuid,
                        ItemNumber:     String((idx + 1) * 10).padStart(6, '0'),
                        Barcode:        (item.barcode || '').replace(/^0+/, ''),
                        Description:    item.description || '',
                        MaterialNumber: item.materialNumber || '',
                        Unit:           'EA',
                        Quantity:       parseFloat(item.quantity) || 0,
                        UnitPrice:      parseFloat(item.unitPrice) || 0,
                        Discount:       parseFloat(item.discount) || 0
                    };
                })
            };
            var response = await s4Post('OCRLogHead', body);
            uuid = response.data?.Uuid || uuid;
            console.log('autoSavePOLog: created Uuid=' + uuid);
            return uuid;
        } catch (e) {
            console.error('autoSavePOLog error: ' + e.message);
            return uuid;
        }
    }

    // ============================================================
    // INTERNAL: autoUpdatePOLog → PATCH to S/4HANA
    // ============================================================
async function autoUpdatePOLog(uuid, status, salesOrderNumber, errorMessage, itemCount, missingBarcodes) {
    if (!uuid) return;
    try {
        var now = new Date().toISOString().slice(0,19).replace('T','').replace(/[-:]/g,'');
        // Truncate fields to prevent S/4HANA PATCH failure due to field length
        var safeErrorMsg = String(errorMessage || '').substring(0, 220);
        var safeSoNumber = String(salesOrderNumber || '').substring(0, 40);
        var safeMissing  = String(missingBarcodes || '').substring(0, 220);

        console.log('autoUpdatePOLog: uuid=' + uuid + ' status=' + status +
            ' SO=' + safeSoNumber + ' errorMsg=' + safeErrorMsg.substring(0, 80));

        await s4Patch("OCRLogHead(" + uuid + ")", {
            Status:           status           || '',
            SalesOrderNumber: safeSoNumber,
            ErrorMessage:     safeErrorMsg,
            ItemCount:        itemCount        || 0,
            MissingBarcodes:  safeMissing,
            UpdatedAt:        now
        });
        console.log('autoUpdatePOLog: PATCH success uuid=' + uuid);
    } catch (e) {
        console.error('autoUpdatePOLog PATCH FAILED: ' + e.message);
        if (e.response?.data) {
            console.error('autoUpdatePOLog response: ' + JSON.stringify(e.response.data).substring(0, 500));
        }
    }
}

    // ============================================================
    // INTERNAL: s4GetPOLog
    // ============================================================
async function s4GetPOLog(uuid) {
    var url = OCR_BASE + "OCRLogHead(" + uuid + ")?$expand=_Items";
    console.log('s4GetPOLog: URL=' + url);

    var response = await executeHttpRequest(
        { destinationName: 'QS4_HTTPS' },
        { method: 'GET', url: url, headers: { 'Accept': 'application/json' }, timeout: 30000 }
    );
    var r = response.data;

    console.log('s4GetPOLog: _Items count=' + (r._Items ? r._Items.length : 0));

    return {
        uuid:             r.Uuid            || '',
        processName:      r.ProcessName     || '',
        pdfName:          r.PdfName         || '',
        mailSubject:      r.MailSubject      || '',
        purchaseOrder:    r.PurchaseOrder    || '',
        deliveryDate:     r.DeliveryDate     || '',
        documentDate:     r.DocumentDate     || '',
        receiverId:       r.ReceiverId       || '',
        currencyCode:     r.CurrencyCode     || '',
        netAmount:        String(r.NetAmount  || ''),
        grossAmount:      String(r.GrossAmount|| ''),
        totalVat:         String(r.TotalVat   || ''),
        discount:         String(r.Discount   || ''),
        deliveryAdress:   r.DeliveryAdress   || '',
        vendorAdress:     r.VendorAdress     || '',
        taxId:            r.TaxId            || '',
        status:           r.Status           || '',
        salesOrderNumber: r.SalesOrderNumber || '',
        errorMessage:     r.ErrorMessage     || '',
        itemCount:        r.ItemCount        || 0,
        missingBarcodes:  r.MissingBarcodes  || '',
        createdAt:        r.CreatedAt        || '',
        updatedAt:        r.UpdatedAt        || '',
        items: (r._Items || []).map(function(item) {
            return {
                HeaderId:       item.HeaderId      || uuid,
                ItemNumber:     item.ItemNumber     || '',
                Barcode:        item.Barcode        || '',
                Description:    item.Description    || '',
                MaterialNumber: item.MaterialNumber || '',
                Unit:           item.Unit           || 'EA',
                Quantity:       parseFloat(item.Quantity)  || 0,
                UnitPrice:      parseFloat(item.UnitPrice) || 0,
                Discount:       parseFloat(item.Discount)  || 0
            };
        })
    };
}

    // ============================================================
    // INTERNAL: S/4HANA HTTP Helpers
    // ============================================================
    async function s4Post(entity, body) {
        return await executeHttpRequest(
            { destinationName: 'QS4_HTTPS' },
            {
                method: 'POST',
                url: OCR_BASE + entity,
                data: body,
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                timeout: 30000
            }
        );
    }

async function s4Patch(entityWithKey, body) {
    // ADIM 1: CSRF token al
    const tokenResp = await executeHttpRequest(
        { destinationName: 'QS4_HTTPS' },
        {
            method: 'GET',
            url: OCR_BASE + '$metadata',
            headers: {
                'x-csrf-token': 'Fetch',
                'Accept': 'application/xml'
            },
            timeout: 30000
        }
    );

    const csrfToken = tokenResp.headers['x-csrf-token'];
    const setCookie = tokenResp.headers['set-cookie'];

    let cookie = '';
    if (setCookie) {
        const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
        cookie = arr.map(c => c.split(';')[0]).join('; ');
    }

    console.log('s4Patch: csrfToken=' + csrfToken);
    console.log('s4Patch: cookie=' + cookie);
    console.log('s4Patch: PATCH → ' + OCR_BASE + entityWithKey);

    // ADIM 2: PATCH - if-match: * eklendi!
    return await executeHttpRequest(
        { destinationName: 'QS4_HTTPS' },
        {
            method: 'PATCH',
            url: OCR_BASE + entityWithKey,
            data: body,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'x-csrf-token': csrfToken,
                'if-match': '*',
                ...(cookie && { 'Cookie': cookie })
            },
            timeout: 30000
        }
    );
}

    // ============================================================
    // EXTRACT MINIMAL DATA
    // ============================================================
    function extractMinimalData(data) {
        var hdr = data.headerFields || {};
        var lineItems = (data.lineItemFields || []).map(function (line) {
            return {
                itemNumber:     getField(line, 'itemNumber'),
                barcode:        getField(line, 'barcode'),
                description:    getField(line, 'description'),
                materialNumber: getField(line, 'materialNumber'),
                quantity:       getField(line, 'quantity'),
                unitPrice:      getField(line, 'unitPrice'),
                discount:       getField(line, 'discount')
            };
        });
        return {
            currencyCode:       getField(hdr, 'currencyCode'),
            deliveryAdress:     getField(hdr, 'deliveryAdress'),
            deliveryDate:       getField(hdr, 'deliveryDate'),
            discount:           getField(hdr, 'discount'),
            documentDate:       getField(hdr, 'documentDate'),
            grossAmount:        getField(hdr, 'grossAmount'),
            netAmount:          getField(hdr, 'netAmount'),
            paymentTerms:       getField(hdr, 'paymentTerms'),
            purchaseOrder:      getField(hdr, 'purchaseOrder'),
            quantity:           getField(hdr, 'quantity'),
            receiverId:         getField(hdr, 'receiverId'),
            taxId:              getField(hdr, 'taxId') || getField(hdr, 'vatNumber'),
            taxIdNumber:        getField(hdr, 'taxIdNumber'),
            totalVAT:           getField(hdr, 'totalVAT'),
            validity:           getField(hdr, 'validity'),
            vendorAdress:       getField(hdr, 'vendorAdress'),
            vendorNo:           getField(hdr, 'vendorNo'),
            deliveryName:       getField(hdr, 'deliveryName'),
            deliveryPhone:      getField(hdr, 'deliveryPhone') || getField(hdr, 'telephone'),
            deliveryCity:       getField(hdr, 'deliveryCity'),
            deliveryPostalCode: getField(hdr, 'deliveryPostalCode'),
            deliveryCountry:    getField(hdr, 'deliveryCountry'),
            lineItems: lineItems
        };
    }

    // ============================================================
    // WRAP FOR BUILD PAYLOAD
    // ============================================================
    function wrapForBuildPayload(minData) {
        function w(val) { return [{ value: val || '' }]; }
        return {
            headerFields: {
                purchaseOrder:      w(minData.purchaseOrder),
                deliveryDate:       w(minData.deliveryDate),
                deliveryAdress:     w(minData.deliveryAdress),
                vendorAdress:       w(minData.vendorAdress),
                receiverId:         w(minData.receiverId),
                taxId:              w(minData.taxId),
                documentDate:       w(minData.documentDate),
                deliveryName:       w(minData.deliveryName),
                deliveryPhone:      w(minData.deliveryPhone),
                deliveryCity:       w(minData.deliveryCity),
                deliveryPostalCode: w(minData.deliveryPostalCode),
                deliveryCountry:    w(minData.deliveryCountry)
            },
            lineItemFields: (minData.lineItems || []).map(function (item) {
                return {
                    barcode:        w(item.barcode),
                    quantity:       w(item.quantity),
                    description:    w(item.description),
                    unitPrice:      w(item.unitPrice),
                    itemNumber:     w(item.itemNumber),
                    materialNumber: w(item.materialNumber),
                    discount:       w(item.discount)
                };
            })
        };
    }

    // ============================================================
    // EXTRACT ALLOWED BUKRS
    // ============================================================
    function extractAllowedBukrs(salesAreaList) {
        if (!salesAreaList || salesAreaList.length === 0) return [];
        var bukrsSet = {};
        for (var i = 0; i < salesAreaList.length; i++) {
            var bukrs = String(salesAreaList[i].Bukrs || salesAreaList[i].BUKRS || '').trim();
            if (bukrs) { bukrsSet[bukrs] = true; }
        }
        return Object.keys(bukrsSet);
    }

    // ============================================================
    // EXTRACT EANS & TAX ID
    // ============================================================
    function extractEansAndTaxId(data) {
        var eans = [];
        var seen = {};
        var taxId = '';

        taxId = getField(data.headerFields, 'taxId')
            || getField(data.headerFields, 'vatNumber')
            || getField(data.headerFields, 'taxNumber')
            || '';
        taxId = taxId.replace(/\s/g, '').trim();

        var lineItems = data.lineItemFields || [];
        for (var i = 0; i < lineItems.length; i++) {
            var line = lineItems[i];
            var barcode = String(getField(line, 'barcode')).replace(/\s/g, '').trim();
            barcode = barcode.replace(/^0+/, '');
            if (!barcode) continue;
            if (!/^\d+$/.test(barcode)) continue;
            if (!seen[barcode]) {
                seen[barcode] = true;
                eans.push(barcode);
            }
        }
        return { eans: eans, taxId: taxId };
    }

    // ============================================================
    // CHECK BARCODES
    // ============================================================
    function checkBarcodes(eans, eanProductMap) {
        var found = [];
        var missing = [];
        for (var i = 0; i < eans.length; i++) {
            if (eanProductMap[eans[i]] && eanProductMap[eans[i]].material) {
                found.push(eans[i]);
            } else {
                missing.push(eans[i]);
            }
        }
        return {
            total: eans.length,
            found: found,
            missing: missing,
            matchRate: eans.length > 0 ? Math.round((found.length / eans.length) * 100) : 0
        };
    }

    // ============================================================
    // LOOKUP PRODUCTS
    // ============================================================
    async function lookupProducts(eans) {
        if (!eans || eans.length === 0) return {};
        var productMap = {};
        var BATCH = 50;
        for (var i = 0; i < eans.length; i += BATCH) {
            var batch = eans.slice(i, i + BATCH);
            var filterParts = batch.map(function (ean) {
                return "ProductStandardID eq '" + String(ean) + "'";
            });
            var filterStr = filterParts.join(' or ');
            var url = "/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product"
                + "?$filter=" + encodeURIComponent(filterStr)
                + "&$select=Product,ProductStandardID,ProductGroup"
                + "&$format=json";
            try {
                var response = await executeHttpRequest(
                    { destinationName: 'QS4_HTTPS' },
                    { method: 'GET', url: url, headers: { 'Accept': 'application/json' }, timeout: 30000 }
                );
                var results = response.data?.d?.results || [];
                for (var r = 0; r < results.length; r++) {
                    var row = results[r];
                    var ean = String(row.ProductStandardID || '').replace(/^0+/, '');
                    if (ean) {
                        productMap[ean] = {
                            material: row.Product || '',
                            productGroup: row.ProductGroup || ''
                        };
                    }
                }
            } catch (e) {
                console.error('Product lookup batch error: ' + e.message);
            }
        }
        return productMap;
    }

    // ============================================================
    // GET SOLD-TO COMPANY CODE
    // ============================================================
    async function getSoldToCompanyCode(soldToParty, allowedBukrs) {
        if (!soldToParty) return '';
        console.log('getSoldToCompanyCode: SoldToParty=' + soldToParty +
                    ' allowedBukrs=[' + (allowedBukrs || []).join(', ') + ']');
        try {
            var url = "/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_CustomerCompany"
                + "?$filter=" + encodeURIComponent("Customer eq '" + soldToParty + "'")
                + "&$select=Customer,CompanyCode"
                + "&$format=json";
            var response = await executeHttpRequest(
                { destinationName: 'QS4_HTTPS' },
                { method: 'GET', url: url, headers: { 'Accept': 'application/json' }, timeout: 30000 }
            );
            var results = response.data?.d?.results || [];
            console.log('KNB1 results: ' + results.length);
            if (results.length === 0) { console.log('No company code found for SoldToParty: ' + soldToParty); return ''; }
            var hasFilter = allowedBukrs && allowedBukrs.length > 0;
            for (var i = 0; i < results.length; i++) {
                var bukrs = results[i].CompanyCode;
                console.log('  KUNNR=' + results[i].Customer + ' BUKRS=' + bukrs);
                if (hasFilter) {
                    if (allowedBukrs.indexOf(bukrs) >= 0) {
                        console.log('✓ MATCH: BUKRS=' + bukrs + ' in allowedBukrs');
                        return bukrs;
                    } else {
                        console.log('  ✗ BUKRS=' + bukrs + ' not in allowedBukrs');
                    }
                } else {
                    console.log('No filter, using first BUKRS: ' + bukrs);
                    return bukrs;
                }
            }
            console.log('✗ No matching BUKRS found in allowedBukrs');
            return '';
        } catch (e) {
            console.error('getSoldToCompanyCode error: ' + e.message);
            return '';
        }
    }

    // ============================================================
    // CREATE SALES ORDER
    // ============================================================
    async function createSalesOrder(soPayload) {
        var requiredFields = ['SalesOrderType','SalesOrganization','DistributionChannel','OrganizationDivision','SoldToParty'];
        var missing = requiredFields.filter(function (f) { return !soPayload[f]; });
        if (missing.length > 0) throw new Error('Missing required header fields: ' + missing.join(', '));
        if (!soPayload.to_Item || soPayload.to_Item.length === 0) throw new Error('Missing line items (to_Item)');
        soPayload.to_Item.forEach(function (item, idx) {
            var itemNo = item.SalesOrderItem || ((idx + 1) * 10);
            if (!item.Material) throw new Error('Item ' + itemNo + ': Missing Material');
            if (!item.RequestedQuantity || Number(item.RequestedQuantity) <= 0) throw new Error('Item ' + itemNo + ': Missing or invalid RequestedQuantity');
            if (!item.RequestedQuantityUnit) item.RequestedQuantityUnit = 'EA';
        });
        console.log('=== SO Summary ===');
        console.log('  Type: ' + soPayload.SalesOrderType);
        console.log('  Sales Org: ' + soPayload.SalesOrganization);
        console.log('  Dist Ch: ' + soPayload.DistributionChannel);
        console.log('  Division: ' + soPayload.OrganizationDivision);
        console.log('  Sold to: ' + soPayload.SoldToParty);
        console.log('  PO#: ' + (soPayload.PurchaseOrderByCustomer || 'N/A'));
        console.log('  Delivery Date: ' + (soPayload.RequestedDeliveryDate || 'N/A'));
        console.log('  Items: ' + soPayload.to_Item.length);
        if (soPayload.to_Item.length > 0) console.log('  Item[0] Plant: ' + (soPayload.to_Item[0].ProductionPlant || 'N/A'));
        console.log('==================');
        var response = await executeHttpRequest(
            { destinationName: 'QS4_HTTPS' },
            {
                method: 'POST',
                url: '/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder',
                data: soPayload,
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                timeout: 60000
            }
        );
        var salesOrder = response.data?.d?.SalesOrder;
        if (!salesOrder) throw new Error('No SalesOrder number in S/4HANA response');
        return { salesOrder: salesOrder };
    }

    // ============================================================
    // BUILD PAYLOAD
    // ============================================================
    async function buildPayload(data, eanProductMap, ctx) {
        var salesAreaList = ctx.salesAreaList;
        var shipToList = ctx.shipToList;
        var processName = ctx.processName || '';
        var overrides = ctx.overrides;
        var allowedBukrs = ctx.allowedBukrs || [];

        var hdr = data.headerFields;
        var purchaseOrder = getField(hdr, 'purchaseOrder');
        var poDate = getField(hdr, 'documentDate');
        var deliveryAddress = getField(hdr, 'deliveryAdress');
        var vendorAddress = getField(hdr, 'vendorAdress');
        var parsedVendor = parseCarrefourVendorAddress(vendorAddress);
        var receiverId = getField(hdr, 'receiverId');
        var deliveryName = getField(hdr, 'deliveryName');
        var deliveryPhone = getField(hdr, 'deliveryPhone') || getField(hdr, 'telephone');
        var deliveryCity = getField(hdr, 'deliveryCity');
        var deliveryPostalCode = getField(hdr, 'deliveryPostalCode');
        var deliveryCountry = getField(hdr, 'deliveryCountry');
        var deliveryDate = getField(hdr, 'deliveryDate');

        var sapDeliveryDate = toSapDate(deliveryDate);
        console.log('buildPayload: deliveryDate raw="' + deliveryDate + '" → SAP="' + sapDeliveryDate + '"');

        vendorAddress = (vendorAddress || '').trim();
        var hasAddress = vendorAddress.length > 0;

        console.log('buildPayload: deliveryAddress="' + deliveryAddress +
                    '" vendorAddress="' + vendorAddress +
                    '" hasAddress=' + hasAddress);

        var eligible1SHD = ['carrefour', 'emaxhtml', 'retail', 'lulu', 'sharafdg', 'eros'];
        var companyLower = processName.toLowerCase();
        console.log('buildPayload: processName=' + processName + ' companyLower=' + companyLower);

        var isEligible = false;
        for (var e = 0; e < eligible1SHD.length; e++) {
            if (companyLower.indexOf(eligible1SHD[e]) >= 0) { isEligible = true; break; }
        }

        var soType = overrides.soType || ((isEligible && hasAddress) ? '1SHD' : '1SSR');
        console.log('buildPayload: isEligible=' + isEligible + ' hasAddress=' + hasAddress +
                    ' override=' + (overrides.soType || 'null') + ' → soType=' + soType);

        var shipToResult = findShipTo(receiverId, hdr, shipToList);
        console.log('buildPayload: ShipToId=' + shipToResult.shipToId +
                   ' SoldToParty=' + shipToResult.soldToParty + ' Company=' + shipToResult.company);

        var soldToParty = shipToResult.soldToParty;
        var companyCode = '';
        if (soldToParty) {
            companyCode = await getSoldToCompanyCode(soldToParty, allowedBukrs);
            console.log('buildPayload: SoldToParty=' + soldToParty + ' → CompanyCode=' + companyCode);
        }
        if (!companyCode) console.warn('buildPayload: No CompanyCode found for SoldToParty=' + soldToParty);

        var lineItems = data.lineItemFields || [];
        var firstMaterial = null;
        var firstProductGroup = '';
        var matkl_fam = '';

        for (var m = 0; m < lineItems.length && !firstMaterial; m++) {
            var barcode = String(getField(lineItems[m], 'barcode')).replace(/\s/g, '').replace(/^0+/, '');
            if (barcode && eanProductMap[barcode] && eanProductMap[barcode].material) {
                firstMaterial = eanProductMap[barcode].material;
                firstProductGroup = eanProductMap[barcode].productGroup || '';
                if (firstProductGroup.length >= 3) matkl_fam = firstProductGroup.substring(0, 3);
                console.log('buildPayload: First Material=' + firstMaterial +
                           ' ProductGroup=' + firstProductGroup + ' MATKL_FAM=' + matkl_fam);
                break;
            }
        }

        var salesAreaMatch = findSalesArea(salesAreaList, companyCode, matkl_fam);
        console.log('SalesArea for BUKRS=' + companyCode + ' MATKL_FAM=' + (matkl_fam || 'N/A') +
                   ' → VKORG:' + salesAreaMatch.vkorg + ' VTWEG:' + salesAreaMatch.vtweg +
                   ' SPART:' + salesAreaMatch.spart + ' Plant:' + salesAreaMatch.plant);

        var itemsArray = [];
        var errors = [];

        for (var i = 0; i < lineItems.length; i++) {
            var line = lineItems[i];
            var barcode2 = String(getField(line, 'barcode')).replace(/\s/g, '').replace(/^0+/, '');
            var description = String(getField(line, 'description') || '').trim();
            var quantity = getField(line, 'quantity');
            var unitPrice = getField(line, 'unitPrice');

            if (barcode2 && !/^\d+$/.test(barcode2)) continue;
            if (!barcode2 && description.length > 100) continue;

            var material = '';
            if (barcode2 && eanProductMap[barcode2]) material = eanProductMap[barcode2].material;
            if (!material && description) {
                var eanKeys = Object.keys(eanProductMap);
                for (var j = 0; j < eanKeys.length; j++) { break; }
            }
            if (!material) {
                errors.push('Satır ' + (i + 1) + ': Malzeme bulunamadı (EAN: ' + barcode2 + ')');
                continue;
            }

            var itemObj = {
                Material: material,
                RequestedQuantity: String(quantity),
                ProductionPlant: salesAreaMatch.plant
            };
            if (unitPrice) {
                itemObj.to_PricingElement = [{
                    ConditionType: overrides.conditionType || 'ZMAN',
                    ConditionRateValue: String(unitPrice)
                }];
            }
            itemsArray.push(itemObj);
        }

        var partnerArray = [];
        if (shipToResult.shipToId) {
            partnerArray.push({ PartnerFunction: 'WE', Customer: shipToResult.shipToId });
        }

        var payload = {
            SalesOrderType:          soType,
            SalesOrganization:       salesAreaMatch.vkorg,
            DistributionChannel:     salesAreaMatch.vtweg,
            OrganizationDivision:    salesAreaMatch.spart,
            PurchaseOrderByCustomer: purchaseOrder,
            RequestedDeliveryDate:   sapDeliveryDate,
            SoldToParty:             soldToParty,
            to_Partner:              partnerArray,
            to_Item:                 itemsArray,
            _errors:                 errors,
            _soldToParty:            soldToParty,
            _companyCode:            companyCode
        };

        if (soType === '1SHD') {
            payload.ZZ8_SOUPD_01_SDH = parsedVendor.name || deliveryName;
            payload.ZZ8_SOUPD_02_SDH = parsedVendor.address;
            payload.ZZ8_SOUPD_03_SDH = parsedVendor.city || deliveryCity;
            payload.ZZ8_SOUPD_04_SDH = deliveryPostalCode;
            payload.ZZ8_SOUPD_05_SDH = deliveryCountry;
            payload.ZZ8_SOUPD_06_SDH = parsedVendor.phone || deliveryPhone;
        }
        return payload;
    }

    // ============================================================
    // FIND SALES AREA
    // ============================================================
    function findSalesArea(salesAreaList, companyCode, matkl_fam) {
        var result = { vkorg: '', vtweg: '', spart: '', plant: '' };
        if (!salesAreaList || salesAreaList.length === 0 || !companyCode) {
            console.log('findSalesArea: empty list or no companyCode');
            return result;
        }
        console.log('findSalesArea: BUKRS=' + companyCode + ' MATKL_FAM=' + (matkl_fam || 'N/A') +
                    ' in ' + salesAreaList.length + ' rows');

        if (matkl_fam) {
            for (var i = 0; i < salesAreaList.length; i++) {
                var row = salesAreaList[i];
                var rowBukrs = String(row.Bukrs || row.BUKRS || '').trim();
                var rowMatkl = String(row.MatklFam || row.MATKL_FAM || '').trim();
                if (rowBukrs === companyCode && rowMatkl === matkl_fam) {
                    result.vkorg = String(row.Vkorg || row.VKORG || '').trim();
                    result.vtweg = String(row.Vtweg || row.VTWEG || '').trim();
                    result.spart = String(row.Spart || row.SPART || '').trim();
                    result.plant = String(row.Site || row.SITE || row.Werks || row.WERKS || '').trim();
                    console.log('findSalesArea: ✓ MATKL_FAM MATCH row ' + i +
                               ' Brand=' + (row.Brand || '') + ' BUKRS=' + rowBukrs +
                               ' MATKL_FAM=' + rowMatkl + ' VKORG=' + result.vkorg);
                    if (result.vkorg) return result;
                }
            }
            console.log('findSalesArea: No MATKL_FAM match, trying default...');
        }

        var defaultMatches = [];
        for (var j = 0; j < salesAreaList.length; j++) {
            var row2 = salesAreaList[j];
            var rowBukrs2 = String(row2.Bukrs || row2.BUKRS || '').trim();
            var rowMatkl2 = String(row2.MatklFam || row2.MATKL_FAM || '').trim();
            var rowBrand = String(row2.Brand || row2.BRAND || '').trim().toUpperCase();
            if (rowBukrs2 === companyCode && !rowMatkl2) {
                defaultMatches.push({
                    brand: rowBrand,
                    vkorg: String(row2.Vkorg || row2.VKORG || '').trim(),
                    vtweg: String(row2.Vtweg || row2.VTWEG || '').trim(),
                    spart: String(row2.Spart || row2.SPART || '').trim(),
                    plant: String(row2.Site || row2.SITE || row2.Werks || row2.WERKS || '').trim()
                });
            }
        }

        for (var d = 0; d < defaultMatches.length; d++) {
            if (defaultMatches[d].brand === 'SON' && defaultMatches[d].vkorg) {
                result = { vkorg: defaultMatches[d].vkorg, vtweg: defaultMatches[d].vtweg,
                           spart: defaultMatches[d].spart, plant: defaultMatches[d].plant };
                console.log('findSalesArea: ✓ DEFAULT MATCH (Brand=SON priority) VKORG=' + result.vkorg);
                return result;
            }
        }

        if (defaultMatches.length > 0 && defaultMatches[0].vkorg) {
            result = { vkorg: defaultMatches[0].vkorg, vtweg: defaultMatches[0].vtweg,
                       spart: defaultMatches[0].spart, plant: defaultMatches[0].plant };
            console.log('findSalesArea: ✓ DEFAULT MATCH (first found) Brand=' + defaultMatches[0].brand + ' VKORG=' + result.vkorg);
            return result;
        }

        for (var k = 0; k < salesAreaList.length; k++) {
            var row3 = salesAreaList[k];
            if (String(row3.Bukrs || row3.BUKRS || '').trim() === companyCode) {
                result.vkorg = String(row3.Vkorg || row3.VKORG || '').trim();
                result.vtweg = String(row3.Vtweg || row3.VTWEG || '').trim();
                result.spart = String(row3.Spart || row3.SPART || '').trim();
                result.plant = String(row3.Site || row3.SITE || row3.Werks || row3.WERKS || '').trim();
                console.log('findSalesArea: ✓ BUKRS-only match (fallback)');
                if (result.vkorg) return result;
            }
        }

        var uniqueBukrs = [];
        var seen = {};
        for (var u = 0; u < salesAreaList.length; u++) {
            var b = String(salesAreaList[u].Bukrs || salesAreaList[u].BUKRS || '');
            if (b && !seen[b]) { seen[b] = true; uniqueBukrs.push(b); }
        }
        console.log('findSalesArea: ✗ No match for BUKRS=' + companyCode +
            '. Available: [' + uniqueBukrs.join(', ') + ']');
        return result;
    }

    // ============================================================
    // FIND SHIP TO
    // ============================================================
    function findShipTo(receiverId, headerFields, shipToList) {
        var emptyResult = { shipToId: '', soldToParty: '', company: '' };
        if (!shipToList || shipToList.length === 0) {
            console.log('findShipTo: empty shipToList');
            return emptyResult;
        }
        var deliveryAddress = getField(headerFields, 'deliveryAdress');
        console.log('findShipTo: receiverId=' + receiverId + ' deliveryAddress=' + deliveryAddress);

        if (receiverId) {
            for (var s = 0; s < shipToList.length; s++) {
                var row = shipToList[s];
                var stId = String(row.ShipToId || '');
                if (stId && stId.indexOf(receiverId) >= 0) {
                    var result = { shipToId: stId, soldToParty: String(row.SoldToParty || '').trim(),
                                   company: String(row.Company || '').trim() };
                    console.log('findShipTo: receiverId match → ShipToId=' + result.shipToId +
                               ' SoldToParty=' + result.soldToParty + ' Company=' + result.company);
                    return result;
                }
            }
        }

        var searchTexts = [];
        if (deliveryAddress) searchTexts.push(deliveryAddress.toLowerCase());
        if (searchTexts.length === 0) {
            console.log('findShipTo: no search criteria (no receiverId, no deliveryAddress)');
            return emptyResult;
        }

        for (var s2 = 0; s2 < shipToList.length; s2++) {
            var row2 = shipToList[s2];
            var addr = String(row2.ShipToAddress || '').toLowerCase().trim();
            if (!addr) continue;
            for (var t = 0; t < searchTexts.length; t++) {
                if (searchTexts[t].indexOf(addr) >= 0 || addr.indexOf(searchTexts[t]) >= 0) {
                    var result2 = { shipToId: String(row2.ShipToId || ''),
                                    soldToParty: String(row2.SoldToParty || '').trim(),
                                    company: String(row2.Company || '').trim() };
                    console.log('findShipTo: address match → ShipToId=' + result2.shipToId +
                               ' SoldToParty=' + result2.soldToParty + ' (addr: ' + addr + ')');
                    return result2;
                }
            }
        }

        var best = { result: emptyResult, score: 0 };
        for (var s3 = 0; s3 < shipToList.length; s3++) {
            var row3 = shipToList[s3];
            var addr2 = String(row3.ShipToAddress || '').toLowerCase().trim();
            if (!addr2) continue;
            var words = addr2.split(/\s+/);
            for (var t2 = 0; t2 < searchTexts.length; t2++) {
                var matchCount = 0;
                for (var w = 0; w < words.length; w++) {
                    if (words[w].length > 2 && searchTexts[t2].indexOf(words[w]) >= 0) matchCount++;
                }
                var score = words.length > 0 ? matchCount / words.length : 0;
                if (score > best.score && score >= 0.5) {
                    best = { result: { shipToId: String(row3.ShipToId || ''),
                                       soldToParty: String(row3.SoldToParty || '').trim(),
                                       company: String(row3.Company || '').trim() }, score: score };
                }
            }
        }

        if (best.result.shipToId) {
            console.log('findShipTo: fuzzy match → ShipToId=' + best.result.shipToId +
                       ' SoldToParty=' + best.result.soldToParty +
                       ' (score: ' + best.score.toFixed(2) + ')');
            return best.result;
        }

        console.log('findShipTo: no match found');
        return emptyResult;
    }

    // ============================================================
    // PROCESS OVERRIDES
    // ============================================================
    function getProcessOverrides(processName) {
        var map = {
            'Carrefour': { conditionType: 'ZMAN', soType: null },
            'Sephora':   { conditionType: 'ZMAN', soType: '1SSR' },
            'Emax':      { conditionType: 'ZMAN', soType: null },
            'Retail':    { conditionType: 'ZMAN', soType: null },
            'Dyson':     { conditionType: 'ZMAN', soType: '1SSR' },
            'VStart':    { conditionType: 'ZMAN', soType: null }
        };
        return map[processName] || { conditionType: 'ZMAN', soType: null };
    }

    // ============================================================
    // HELPERS
    // ============================================================
    function getField(obj, fieldName) {
        if (obj && obj[fieldName] && obj[fieldName].length > 0 &&
            obj[fieldName][0].value !== undefined) {
            var val = String(obj[fieldName][0].value);
            return val.trim();
        }
        return '';
    }

    function parseJsonField(val) {
        if (!val) return [];
        if (typeof val === 'string') {
            try { return JSON.parse(val); } catch (e) { return []; }
        }
        return Array.isArray(val) ? val : [];
    }

    function toAbapDate(str) {
        if (!str) return '';
        return str.replace(/-/g, '').substring(0, 8);
    }

    function toSapDate(dateStr) {
        if (!dateStr) return '';
        var normalized = dateStr.trim();
        var dmySlash = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (dmySlash) normalized = dmySlash[3] + '-' + dmySlash[2] + '-' + dmySlash[1];
        var dmyDot = normalized.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        if (dmyDot) normalized = dmyDot[3] + '-' + dmyDot[2] + '-' + dmyDot[1];
        var ms = new Date(normalized).getTime();
        if (isNaN(ms)) {
            console.warn('toSapDate: invalid date: ' + dateStr);
            return '';
        }
        return '/Date(' + ms + ')/';
    }

    function parseCarrefourVendorAddress(vendorAdress) {
        var result = { name: '', phone: '', address: '', city: '' };
        if (!vendorAdress) return result;
        var nameMatch = vendorAdress.match(/Name:\s*([^T]+?)(?=\s+Tel:|$)/i);
        if (nameMatch) result.name = nameMatch[1].trim();
        var telMatch = vendorAdress.match(/Tel:\s*([^\s]+)/i);
        if (telMatch) result.phone = telMatch[1].trim();
        var addrMatch = vendorAdress.match(/Address:\s*(.+)$/i);
        if (addrMatch) {
            var fullAddress = addrMatch[1].trim();
            var cityMatch = fullAddress.match(/-\s*([A-Za-z\s]+)$/);
            if (cityMatch) {
                result.city = cityMatch[1].trim();
                result.address = fullAddress.replace(/-\s*[A-Za-z\s]+$/, '').trim();
            } else {
                result.address = fullAddress;
            }
        }
        console.log('parseCarrefourVendorAddress: name="' + result.name +
                    '" phone="' + result.phone +
                    '" address="' + result.address +
                    '" city="' + result.city + '"');
        return result;
    }

    function extractKeyFromWhere(where, fieldName) {
        if (!where || !Array.isArray(where)) return null;
        const find = (arr) => {
            for (let i = 0; i < arr.length; i++) {
                if (arr[i]?.ref?.[0] === fieldName && arr[i+2]?.val) return arr[i+2].val;
                if (arr[i]?.xpr) { const v = find(arr[i].xpr); if (v) return v; }
            }
            return null;
        };
        return find(where);
    }

    await super.init();
}}