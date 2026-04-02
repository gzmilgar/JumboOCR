// srv/ocr-service.js
const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

var OCR_BASE = '/sap/opu/odata4/sap/zsdocr_sb_log_o4/srvd/sap/zsd_ocr_log_srv/0001/';

// STSA cache - keyed by processName, TTL 10 minutes
var _stsaCache = {};
var STSA_CACHE_TTL = 10 * 60 * 1000;

function statusCriticality(status) {
    switch ((status || '').toUpperCase()) {
        case 'SUCCESS':  return 3; // Positive (green)
        case 'FAILED':   return 1; // Negative (red)
        case 'RETRYING': return 2; // Critical (orange)
        case 'PENDING':  return 2; // Critical (orange)
        default:         return 0; // None (neutral)
    }
}

// Format S/4HANA date strings: "20260329" → "2026-03-29", "20260329110350" → "2026-03-29 11:03:50"
function formatS4Date(val) {
    if (!val || typeof val !== 'string') return val || '';
    var s = val.replace(/[^0-9]/g, '');
    if (s.length >= 8) {
        var d = s.substring(0,4) + '-' + s.substring(4,6) + '-' + s.substring(6,8);
        if (s.length >= 14) d += ' ' + s.substring(8,10) + ':' + s.substring(10,12) + ':' + s.substring(12,14);
        return d;
    }
    return val;
}

// Build OData $filter from CDS SELECT.where array
function buildODataFilter(where) {
    if (!where || !Array.isArray(where) || where.length === 0) return '';
    var parts = [];
    for (var i = 0; i < where.length; i++) {
        var w = where[i];
        if (typeof w === 'string') {
            // 'and', 'or' operators
            parts.push(w);
        } else if (w.ref) {
            // field reference - look for operator + value
            var field = w.ref[0];
            var op = where[i+1];
            var valObj = where[i+2];
            if (op && valObj && valObj.val !== undefined) {
                var odataOp = op === '=' ? 'eq' : op === '!=' ? 'ne' : op === '>' ? 'gt' : op === '<' ? 'lt' : op === '>=' ? 'ge' : op === '<=' ? 'le' : op;
                parts.push(field + " " + odataOp + " '" + valObj.val + "'");
                i += 2; // skip op and val
            } else if (op && typeof op === 'string' && op.toLowerCase() === 'like' && valObj && valObj.val !== undefined) {
                // contains filter
                var likeVal = String(valObj.val).replace(/%/g, '');
                parts.push("contains(" + field + ",'" + likeVal + "')");
                i += 2;
            }
        }
    }
    return parts.join(' ');
}

module.exports = class extends cds.ApplicationService { async init() {

    // ============================================================
    // OCRLogs READ (list + single record)
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

            // 3) WHERE clause (top-level)
            if (!uuid) {
                uuid = extractKeyFromWhere(req.query?.SELECT?.where, 'Uuid');
            }

            // 4) FROM ref where clause (bound action entity resolution)
            //    CAP puts key in: SELECT.from.ref[0].where for bound actions
            if (!uuid) {
                try {
                    var fromRef = req.query?.SELECT?.from?.ref;
                    if (Array.isArray(fromRef)) {
                        for (var fi = 0; fi < fromRef.length; fi++) {
                            if (fromRef[fi] && fromRef[fi].where) {
                                uuid = extractKeyFromWhere(fromRef[fi].where, 'Uuid');
                                if (uuid) break;
                            }
                        }
                    }
                } catch(e) { /* ignore */ }
            }

            // 5) Last resort: try to extract from the raw URL/path
            if (!uuid) {
                try {
                    var rawUrl = req._.req?.url || req._.req?.path || '';
                    var m = rawUrl.match(/OCRLogs\('([^']+)'\)/);
                    if (m) uuid = m[1];
                } catch(e) { /* ignore */ }
            }

            console.log('OCRLogs READ: uuid=' + (uuid || 'null') + ' params=' + JSON.stringify(req.params));

if (uuid) {
    const r = await s4GetPOLog(uuid);
    return [{
        Uuid: r.uuid || '', ProcessName: r.processName || '',
        PdfName: r.pdfName || '', MailSubject: '',
        PurchaseOrder: r.purchaseOrder || '', DeliveryDate: formatS4Date(r.deliveryDate),
        DocumentDate: formatS4Date(r.documentDate), ReceiverId: r.receiverId || '',
        CurrencyCode: r.currencyCode || '', NetAmount: parseFloat(r.netAmount) || 0,
        GrossAmount: parseFloat(r.grossAmount) || 0, TotalVat: r.totalVat || '',
        Discount: parseFloat(r.discount) || 0, DeliveryAdress: r.deliveryAdress || '',
        VendorAdress: r.vendorAdress || '', Status: r.status || '',
        StatusCriticality: statusCriticality(r.status),
        SalesOrderNumber: r.salesOrderNumber || '', ErrorMessage: r.errorMessage || '',
        MissingBarcodes: r.missingBarcodes || '', ItemCount: r.itemCount || 0,
        CreatedAt: formatS4Date(r.createdAt), UpdatedAt: formatS4Date(r.updatedAt),
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
                // Build S/4HANA URL with filter support
                var s4Url = OCR_BASE + 'OCRLogHead?$orderby=CreatedAt desc&$top=200';
                var oFilter = buildODataFilter(req.query?.SELECT?.where);
                if (oFilter) {
                    s4Url += '&$filter=' + encodeURIComponent(oFilter);
                    console.log('OCRLogs READ: $filter=' + oFilter);
                }
                const response = await executeHttpRequest(
                    { destinationName: 'QS4_HTTPS' },
                    { method: 'GET', url: s4Url,
                      headers: { 'Accept': 'application/json' }, timeout: 30000 }
                );
                return (response.data?.value || []).map(r => ({
                    Uuid: r.Uuid || '', ProcessName: r.ProcessName || '',
                    PdfName: r.PdfName || '', MailSubject: r.MailSubject || '',
                    PurchaseOrder: r.PurchaseOrder || '', DeliveryDate: formatS4Date(r.DeliveryDate),
                    DocumentDate: formatS4Date(r.DocumentDate), ReceiverId: r.ReceiverId || '',
                    CurrencyCode: r.CurrencyCode || '', NetAmount: r.NetAmount || 0,
                    GrossAmount: r.GrossAmount || 0, TotalVat: r.TotalVat || '',
                    Discount: r.Discount || 0, DeliveryAdress: r.DeliveryAdress || '',
                    VendorAdress: r.VendorAdress || '', Status: r.Status || '',
                    StatusCriticality: statusCriticality(r.Status),
                    SalesOrderNumber: r.SalesOrderNumber || '', ErrorMessage: r.ErrorMessage || '',
                    MissingBarcodes: r.MissingBarcodes || '', ItemCount: r.ItemCount || 0,
                    CreatedAt: formatS4Date(r.CreatedAt), UpdatedAt: formatS4Date(r.UpdatedAt)
                }));
            }
        } catch (e) {
            console.error('OCRLogs READ error:', e.message);
            return [];
        }
    });

    // ============================================================
    // OCRItems READ
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
    // UPDATE handler
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

        // ── 3. FETCH UPDATED DATA FROM S/4HANA ───────────────────
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
    // SHARED: _executeSalesOrderCreation
    // Single function used by both triggerLog and processAndCreateSalesOrder
    // ============================================================
    async function _executeSalesOrderCreation(uuid, processName) {
        // 1. Read log data from S/4HANA
        var logEntry = await s4GetPOLog(uuid);
        if (!logEntry) throw new Error('POLog not found: ' + uuid);
        processName = processName || logEntry.processName || 'Unknown';
        console.log('═══════════════════════════════════════════════════');
        console.log('[' + processName + '] _execute START uuid=' + uuid);
        console.log('[' + processName + '] PO=' + logEntry.purchaseOrder +
                   ' receiverId=' + logEntry.receiverId +
                   ' deliveryAdress=' + (logEntry.deliveryAdress || '').substring(0, 50) +
                   ' items=' + logEntry.items.length);
        if (logEntry.items.length > 0) {
            console.log('[' + processName + '] Item[0]: Barcode=' + logEntry.items[0].Barcode +
                       ' Material=' + logEntry.items[0].MaterialNumber +
                       ' Qty=' + logEntry.items[0].Quantity);
        }

        // 2. Get STSA via cache
        var stsaResult = await getCachedStsa(processName);
        console.log('[' + processName + '] STSA: success=' + stsaResult.success + ' msg=' + stsaResult.message);
        if (!stsaResult.success) {
            console.error('[' + processName + '] STSA FAILED - shipTo and salesArea data unavailable');
        }
        var stsa = { shipToPartners: stsaResult.shipToPartners, salesAreaMap: stsaResult.salesAreaMap };
        var shipToList = parseJsonField(stsa.shipToPartners);
        var salesAreaList = parseJsonField(stsa.salesAreaMap);
        console.log('[' + processName + '] ShipTo count=' + shipToList.length + ' SalesArea count=' + salesAreaList.length);

        // 3. Build data from log entry
        var minData = {
            purchaseOrder: logEntry.purchaseOrder, deliveryDate: logEntry.deliveryDate,
            documentDate: logEntry.documentDate, receiverId: logEntry.receiverId,
            currencyCode: logEntry.currencyCode, netAmount: logEntry.netAmount,
            grossAmount: logEntry.grossAmount, discount: logEntry.discount,
            deliveryAdress: logEntry.deliveryAdress, vendorAdress: logEntry.vendorAdress, taxId: logEntry.taxId,
            lineItems: logEntry.items.map(function(i) {
                return { barcode: i.Barcode||'', quantity: String(i.Quantity||''), unitPrice: String(i.UnitPrice||''),
                         discount: String(i.Discount||''), itemNumber: i.ItemNumber||'', description: i.Description||'',
                         materialNumber: i.MaterialNumber||'' };
            })
        };
        var data = wrapForBuildPayload(minData);

        // 4. Update status to RETRYING
        await autoUpdatePOLog(uuid, 'RETRYING', '', '', 0, '');

        // 5. Process sales order
        console.log('[' + processName + '] Calling _processSalesOrder...');
        var result = await _processSalesOrder(data, stsa, processName);
        console.log('[' + processName + '] Result: success=' + result.success +
                   ' SO=' + result.salesOrderNumber + ' msg=' + result.message);
        console.log('═══════════════════════════════════════════════════');

        // 6. Update log with result
        await autoUpdatePOLog(uuid, result.success ? 'SUCCESS' : 'FAILED',
            result.salesOrderNumber || '', result.success ? '' : (result.message || ''),
            result.itemCount || 0, result.missingBarcodes || '');

        return result;
    }

    // ============================================================
    // SHARED: extractErrorMessage from S/4HANA error
    // ============================================================
    function extractErrorMessage(e) {
        if (e.response?.data?.error?.message?.value) return e.response.data.error.message.value;
        if (e.response?.data?.error?.innererror?.errordetails) {
            return e.response.data.error.innererror.errordetails.map(function(d) { return d.message; }).join('; ');
        }
        if (e.response?.data?.error?.message) {
            return typeof e.response.data.error.message === 'string'
                ? e.response.data.error.message : JSON.stringify(e.response.data.error.message);
        }
        return e.message || 'Unknown error';
    }

    // ============================================================
    // triggerLog - calls shared _executeSalesOrderCreation
    // ============================================================
    this.on('triggerLog', async (req) => {
        var uuid = req.data?.uuid;
        console.log('=== triggerLog called: uuid=' + uuid + ' ===');
        try {
            if (!uuid) return { success: false, message: 'UUID is required', salesOrder: '' };
            var result = await _executeSalesOrderCreation(uuid, null);
            return { success: result.success, message: result.message || 'Sales order creation failed', salesOrder: result.salesOrderNumber || '' };
        } catch (e) {
            console.error('triggerLog error: ' + e.message);
            var errorMsg = extractErrorMessage(e);
            try { await autoUpdatePOLog(uuid, 'FAILED', '', errorMsg, 0, ''); } catch (e2) {}
            return { success: false, message: errorMsg, salesOrder: '' };
        }
    });

    // ============================================================
    // 1) lookupShipToAndSalesArea
    // ============================================================
    this.on('lookupShipToAndSalesArea', async (req) => {
        try {
            console.log('=== lookupShipToAndSalesArea action called ===');
            return await _lookupShipToAndSalesArea(req.data.ocrCompany);
        } catch (error) {
            console.error('lookupShipToAndSalesArea Error: ' + error.message);
            var errorMsg = error.response?.data?.error?.message?.value || error.message || 'Unknown error';
            return { shipToPartners: '[]', salesAreaMap: '[]', success: false, message: 'Failed: ' + errorMsg };
        }
    });

    // ============================================================
    // 2) processAndCreateSalesOrder - saves log then calls shared function
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

            // Save log to S/4HANA first
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

            // Use the SAME shared function as triggerLog
            var result = await _executeSalesOrderCreation(logUuid, processName);
            return result;

        } catch (error) {
            console.error('[' + processName + '] ERROR: ' + error.message);
            var errorMsg = extractErrorMessage(error);
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
        // PurchaseOrder is a key/identifier field - not patchable on S/4HANA
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
                console.warn('updatePOLogData: item[' + i + '] invalid ItemNumber, skipping');
                continue;
            }

            var itemPatch = {};
            if (item.barcode        !== undefined) itemPatch.Barcode        = item.barcode              || '';
            if (item.materialNumber !== undefined) itemPatch.MaterialNumber = item.materialNumber        || '';
            if (item.quantity       !== undefined) {
                itemPatch.Quantity       = parseFloat(item.quantity)  || 0;
                if (!itemPatch.Unit) itemPatch.Unit = item.unit || 'EA';
            }
            if (item.unitPrice      !== undefined) itemPatch.UnitPrice     = parseFloat(item.unitPrice) || 0;
            if (item.discount       !== undefined) itemPatch.Discount      = parseFloat(item.discount)  || 0;

            // PascalCase de gelebilir kontrol et
            if (item.Barcode        !== undefined) itemPatch.Barcode        = item.Barcode              || '';
            if (item.MaterialNumber !== undefined) itemPatch.MaterialNumber = item.MaterialNumber        || '';
            if (item.Quantity       !== undefined) {
                itemPatch.Quantity       = parseFloat(item.Quantity)  || 0;
                if (!itemPatch.Unit) itemPatch.Unit = item.Unit || item.unit || 'EA';
            }
            if (item.UnitPrice      !== undefined) itemPatch.UnitPrice     = parseFloat(item.UnitPrice) || 0;
            if (item.Discount       !== undefined) itemPatch.Discount      = parseFloat(item.Discount)  || 0;

            if (Object.keys(itemPatch).length > 0) {
                var itemUrl = "OCRLogItem(HeaderId=" + uuid + 
                              ",ItemNumber='" + paddedItemNo + "')";
                console.log('updatePOLogData: PATCH URL=' + itemUrl);
                console.log('updatePOLogData: PATCH body=' + JSON.stringify(itemPatch));
                await s4Patch(itemUrl, itemPatch);
                console.log('updatePOLogData: item PATCH success ItemNumber=' + paddedItemNo);
            }
        }

        // ── 3. FETCH UPDATED DATA FROM S/4HANA AND RETURN ──────
        console.log('updatePOLogData: fetching updated data...');
        const updated = await s4GetPOLog(uuid);
        console.log('updatePOLogData: fetch success');

        return {
            success: true,
            message: 'Updated successfully',
            // Updated header fields
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
            // Updated item fields
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
        var errMsg = e.message || 'Unknown error';
        // Try to extract detailed error from S/4HANA response
        if (e.response && e.response.data) {
            var s4Err = e.response.data;
            if (s4Err.error && s4Err.error.message) {
                errMsg = typeof s4Err.error.message === 'object' ? s4Err.error.message.value : s4Err.error.message;
            } else if (typeof s4Err === 'string') {
                errMsg = s4Err;
            }
        }
        console.error('updatePOLogData error: ' + errMsg);
        console.error('updatePOLogData stack: ' + e.stack);
        return { success: false, message: errMsg };
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
        var descBarcodes = extracted.descBarcodes;
        var taxId = extracted.taxId;
        console.log('[' + processName + '] EANs:' + eans.length + ' DescBarcodes:' + descBarcodes.length + ' TaxId:' + taxId);

        var eanProductMap = await lookupProducts(eans, descBarcodes);
        console.log('[' + processName + '] Products:' + Object.keys(eanProductMap).length + '/' + (eans.length + descBarcodes.length));

        var allBarcodes = eans.concat(descBarcodes);
        var barcodeReport = checkBarcodes(allBarcodes, eanProductMap);
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
                message: 'SoldToParty not found. Errors: ' + errors.join('; '),
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
                message: 'No valid items. Errors: ' + errors.join('; '),
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
    // INTERNAL: _lookupShipToAndSalesArea
    // ============================================================
    async function _lookupShipToAndSalesArea(ocrCompany) {
        if (!ocrCompany) {
            return { shipToPartners: '[]', salesAreaMap: '[]', success: false, message: 'ocrCompany parameter is required' };
        }
        console.log('_lookupShipToAndSalesArea: Company=' + ocrCompany);
        var basePath = "/sap/opu/odata4/sap/zsdocr_sb_shp_prt/srvd/sap/zsdocr_sd_shp_prt/0001";
        var url = basePath + "/Root"
            + "?$expand=_ShipToPartner($filter=" + encodeURIComponent("Company eq '" + ocrCompany + "'") + ")"
            + ",_SalesAreaMap"
            + "&$format=json";

        var response = await executeHttpRequest(
            { destinationName: 'QS4_HTTPS' },
            { method: 'GET', url: url, headers: { 'Accept': 'application/json' }, timeout: 30000 }
        );

        var results = response.data?.value || [];
        var shipToResults = [];
        var salesAreaResults = [];
        results.forEach(function (item) {
            if (item._ShipToPartner) shipToResults = shipToResults.concat(item._ShipToPartner);
            if (item._SalesAreaMap) salesAreaResults = salesAreaResults.concat(item._SalesAreaMap);
        });

        console.log('_lookupShipToAndSalesArea: ShipTo=' + shipToResults.length + ' SalesArea=' + salesAreaResults.length);

        if (shipToResults.length === 0 && salesAreaResults.length === 0) {
            return { shipToPartners: '[]', salesAreaMap: '[]', success: false, message: 'No data found for: ' + ocrCompany };
        }
        return {
            shipToPartners: JSON.stringify(shipToResults),
            salesAreaMap: JSON.stringify(salesAreaResults),
            success: true,
            message: 'ShipTo: ' + shipToResults.length + ' records, SalesArea: ' + salesAreaResults.length + ' records'
        };
    }

    // ============================================================
    // CACHED STSA LOOKUP - avoids repeated S/4HANA calls for same processName
    // ============================================================
    async function getCachedStsa(processName) {
        var key = (processName || '').trim();
        var cached = _stsaCache[key];
        if (cached && (Date.now() - cached.timestamp) < STSA_CACHE_TTL) {
            console.log('STSA cache HIT for: ' + key + ' (age: ' + Math.round((Date.now() - cached.timestamp) / 1000) + 's)');
            return cached.data;
        }
        console.log('STSA cache MISS for: ' + key + ', calling S/4HANA...');
        var result = await _lookupShipToAndSalesArea(key);
        if (result.success) {
            _stsaCache[key] = { data: result, timestamp: Date.now() };
            console.log('STSA cached for: ' + key);
        }
        return result;
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
            ErrorMessage:     safeErrorMsg
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
                currencyCode:       w(minData.currencyCode),
                netAmount:          w(minData.netAmount),
                grossAmount:        w(minData.grossAmount),
                discount:           w(minData.discount),
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
        var descBarcodes = [];
        var seen = {};

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
            if (!seen[barcode]) {
                seen[barcode] = true;
                if (/^\d+$/.test(barcode)) {
                    eans.push(barcode);
                } else {
                    descBarcodes.push(barcode);
                }
            }
        }
        return { eans: eans, descBarcodes: descBarcodes, taxId: taxId };
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
    async function lookupProducts(eans, descBarcodes) {
        var productMap = {};
        var BATCH = 50;

        // Step 1: Lookup by EAN (ProductStandardID)
        if (eans && eans.length > 0) {
            for (var i = 0; i < eans.length; i += BATCH) {
                var batch = eans.slice(i, i + BATCH);
                var filterParts = batch.map(function (ean) {
                    return "ProductStandardID eq '" + String(ean) + "'";
                });
                var filterStr = filterParts.join(' or ');
                var url = "/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product"
                    + "?$filter=" + encodeURIComponent(filterStr)
                    + "&$select=Product,ProductStandardID,ProductGroup,Brand"
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
                                productGroup: row.ProductGroup || '',
                                brand: row.Brand || ''
                            };
                        }
                    }
                } catch (e) {
                    console.error('Product lookup EAN batch error: ' + e.message);
                }
            }
        }

        // Step 2: For EANs not found, try Description (MAKTX) lookup
        var missingEans = (eans || []).filter(function (ean) { return !productMap[ean]; });
        var allDescLookups = missingEans.concat(descBarcodes || []);

        if (allDescLookups.length > 0) {
            console.log('lookupProducts: Trying description lookup for: ' + allDescLookups.join(', '));
            for (var d = 0; d < allDescLookups.length; d++) {
                var desc = allDescLookups[d];
                if (productMap[desc]) continue;
                try {
                    var descUrl = "/sap/opu/odata/sap/API_PRODUCT_SRV/A_ProductDescription"
                        + "?$filter=" + encodeURIComponent("substringof('" + desc + "',ProductDescription)")
                        + "&$select=Product,ProductDescription,Language"
                        + "&$top=1"
                        + "&$format=json";
                    var descResp = await executeHttpRequest(
                        { destinationName: 'QS4_HTTPS' },
                        { method: 'GET', url: descUrl, headers: { 'Accept': 'application/json' }, timeout: 30000 }
                    );
                    var descResults = descResp.data?.d?.results || [];
                    if (descResults.length > 0) {
                        var foundProduct = descResults[0].Product || '';
                        console.log('lookupProducts: Description match "' + desc + '" → Material=' + foundProduct);
                        // Now get full product details
                        var prodUrl = "/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product('" + encodeURIComponent(foundProduct) + "')"
                            + "?$select=Product,ProductStandardID,ProductGroup,Brand"
                            + "&$format=json";
                        var prodResp = await executeHttpRequest(
                            { destinationName: 'QS4_HTTPS' },
                            { method: 'GET', url: prodUrl, headers: { 'Accept': 'application/json' }, timeout: 30000 }
                        );
                        var prodData = prodResp.data?.d || {};
                        productMap[desc] = {
                            material: prodData.Product || foundProduct,
                            productGroup: prodData.ProductGroup || '',
                            brand: prodData.Brand || ''
                        };
                    } else {
                        console.log('lookupProducts: No description match for "' + desc + '"');
                    }
                } catch (e) {
                    console.error('Product description lookup error for "' + desc + '": ' + e.message);
                }
            }
        }

        return productMap;
    }

    // ============================================================
    // LOOKUP MATERIAL SALES AREA from A_ProductSalesDelivery
    // ============================================================
    async function lookupMaterialSalesArea(material) {
        if (!material) return [];
        // Try multiple URL patterns - different S/4HANA versions expose different endpoints
        var urls = [
            "/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product('" + encodeURIComponent(material) + "')/to_SalesDelivery"
                + "?$select=Product,ProductSalesOrg,ProductDistributionChnl,ProductDivision&$format=json",
            "/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product('" + encodeURIComponent(material) + "')/to_ProductSalesDelivery"
                + "?$select=Product,ProductSalesOrg,ProductDistributionChnl,ProductDivision&$format=json",
            "/sap/opu/odata/sap/API_PRODUCT_SRV/A_ProductSalesDelivery"
                + "?$filter=" + encodeURIComponent("Product eq '" + material + "'")
                + "&$select=Product,ProductSalesOrg,ProductDistributionChnl,ProductDivision&$format=json"
        ];
        for (var u = 0; u < urls.length; u++) {
            try {
                console.log('lookupMaterialSalesArea: trying URL pattern ' + (u + 1) + '/' + urls.length);
                var response = await executeHttpRequest(
                    { destinationName: 'QS4_HTTPS' },
                    { method: 'GET', url: urls[u], headers: { 'Accept': 'application/json' }, timeout: 30000 }
                );
                var results = response.data?.d?.results || [];
                console.log('lookupMaterialSalesArea: Material=' + material + ' found ' + results.length + ' sales areas (pattern ' + (u + 1) + ')');
                var salesAreas = [];
                for (var i = 0; i < results.length; i++) {
                    var sa = {
                        vkorg: String(results[i].ProductSalesOrg || '').trim(),
                        vtweg: String(results[i].ProductDistributionChnl || '').trim(),
                        spart: String(results[i].ProductDivision || '').trim()
                    };
                    console.log('  SalesArea[' + i + ']: VKORG=' + sa.vkorg + ' VTWEG=' + sa.vtweg + ' SPART=' + sa.spart);
                    salesAreas.push(sa);
                }
                return salesAreas;
            } catch (e) {
                console.warn('lookupMaterialSalesArea: pattern ' + (u + 1) + ' failed: ' + e.message);
            }
        }
        console.error('lookupMaterialSalesArea: all URL patterns failed for material ' + material);
        return [];
    }

    // ============================================================
    // LOOKUP CUSTOMER SALES AREAS from A_CustomerSalesArea
    // ============================================================
    async function lookupCustomerSalesAreas(customer) {
        if (!customer) return [];
        try {
            var url = "/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_CustomerSalesArea"
                + "?$filter=" + encodeURIComponent("Customer eq '" + customer + "'")
                + "&$select=Customer,SalesOrganization,DistributionChannel,Division"
                + "&$format=json";
            var response = await executeHttpRequest(
                { destinationName: 'QS4_HTTPS' },
                { method: 'GET', url: url, headers: { 'Accept': 'application/json' }, timeout: 30000 }
            );
            var results = response.data?.d?.results || [];
            console.log('lookupCustomerSalesAreas: Customer=' + customer + ' found ' + results.length + ' sales areas');
            var salesAreas = [];
            for (var i = 0; i < results.length; i++) {
                var sa = {
                    vkorg: String(results[i].SalesOrganization || '').trim(),
                    vtweg: String(results[i].DistributionChannel || '').trim(),
                    spart: String(results[i].Division || '').trim()
                };
                console.log('  CustomerSalesArea[' + i + ']: VKORG=' + sa.vkorg + ' VTWEG=' + sa.vtweg + ' SPART=' + sa.spart);
                salesAreas.push(sa);
            }
            return salesAreas;
        } catch (e) {
            console.error('lookupCustomerSalesAreas error: ' + e.message);
            return [];
        }
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
        var firstBrand = '';
        var matkl_fam = '';

        for (var m = 0; m < lineItems.length && !firstMaterial; m++) {
            var barcode = String(getField(lineItems[m], 'barcode')).replace(/\s/g, '').replace(/^0+/, '');
            if (barcode && eanProductMap[barcode] && eanProductMap[barcode].material) {
                firstMaterial = eanProductMap[barcode].material;
                firstProductGroup = eanProductMap[barcode].productGroup || '';
                firstBrand = eanProductMap[barcode].brand || '';
                if (firstProductGroup.length >= 3) matkl_fam = firstProductGroup.substring(0, 3);
                console.log('buildPayload: First Material=' + firstMaterial +
                           ' ProductGroup=' + firstProductGroup + ' Brand=' + firstBrand +
                           ' MATKL_FAM=' + matkl_fam);
                break;
            }
        }

        // Look up actual sales areas for the material from S/4HANA
        var materialSalesAreas = [];
        if (firstMaterial) {
            materialSalesAreas = await lookupMaterialSalesArea(firstMaterial);
        }

        // Try to match material's actual sales area against salesAreaMap
        var salesAreaMatch = { vkorg: '', vtweg: '', spart: '', plant: '' };
        if (materialSalesAreas.length > 0 && salesAreaList.length > 0) {
            for (var sa = 0; sa < materialSalesAreas.length; sa++) {
                var matSA = materialSalesAreas[sa];
                for (var sl = 0; sl < salesAreaList.length; sl++) {
                    var row = salesAreaList[sl];
                    var rowVkorg = String(row.Vkorg || row.VKORG || '').trim();
                    var rowVtweg = String(row.Vtweg || row.VTWEG || '').trim();
                    if (rowVkorg === matSA.vkorg && rowVtweg === matSA.vtweg) {
                        salesAreaMatch.vkorg = rowVkorg;
                        salesAreaMatch.vtweg = rowVtweg;
                        salesAreaMatch.spart = String(row.Spart || row.SPART || '').trim() || matSA.spart;
                        salesAreaMatch.plant = String(row.Site || row.SITE || row.Werks || row.WERKS || '').trim();
                        console.log('buildPayload: ✓ MATERIAL SALES AREA MATCH → VKORG=' + salesAreaMatch.vkorg +
                                   ' VTWEG=' + salesAreaMatch.vtweg + ' SPART=' + salesAreaMatch.spart +
                                   ' Plant=' + salesAreaMatch.plant + ' (from salesAreaMap row ' + sl + ')');
                        break;
                    }
                }
                if (salesAreaMatch.vkorg) break;
            }
            // If no match in salesAreaMap, use material's first sales area directly
            if (!salesAreaMatch.vkorg && materialSalesAreas.length > 0) {
                salesAreaMatch.vkorg = materialSalesAreas[0].vkorg;
                salesAreaMatch.vtweg = materialSalesAreas[0].vtweg;
                salesAreaMatch.spart = materialSalesAreas[0].spart;
                console.log('buildPayload: Using material sales area directly (no salesAreaMap match) → VKORG=' +
                           salesAreaMatch.vkorg + ' VTWEG=' + salesAreaMatch.vtweg);
            }
        }

        // Fallback to old logic if material sales area lookup didn't work
        if (!salesAreaMatch.vkorg) {
            salesAreaMatch = findSalesArea(salesAreaList, companyCode, matkl_fam, firstBrand);
        }
        console.log('SalesArea FINAL → VKORG:' + salesAreaMatch.vkorg + ' VTWEG:' + salesAreaMatch.vtweg +
                   ' SPART:' + salesAreaMatch.spart + ' Plant:' + salesAreaMatch.plant);

        // Validate chosen sales area against customer's actual assignments
        if (soldToParty && salesAreaMatch.vkorg) {
            var customerSalesAreas = await lookupCustomerSalesAreas(soldToParty);
            if (customerSalesAreas.length > 0) {
                var isValid = false;
                for (var cv = 0; cv < customerSalesAreas.length; cv++) {
                    if (customerSalesAreas[cv].vkorg === salesAreaMatch.vkorg &&
                        customerSalesAreas[cv].vtweg === salesAreaMatch.vtweg) {
                        isValid = true;
                        // Use customer's division if it differs (customer master takes precedence)
                        if (customerSalesAreas[cv].spart && customerSalesAreas[cv].spart !== salesAreaMatch.spart) {
                            console.log('buildPayload: Adjusting Division from ' + salesAreaMatch.spart +
                                       ' to ' + customerSalesAreas[cv].spart + ' (customer master)');
                            salesAreaMatch.spart = customerSalesAreas[cv].spart;
                        }
                        console.log('buildPayload: ✓ Customer ' + soldToParty + ' is assigned to sales area ' +
                                   salesAreaMatch.vkorg + '/' + salesAreaMatch.vtweg + '/' + salesAreaMatch.spart);
                        break;
                    }
                }
                if (!isValid) {
                    var brandUC = (firstBrand || '').trim().toUpperCase();
                    var custSAList = customerSalesAreas.map(function(c) { return c.vkorg + '/' + c.vtweg + '/' + c.spart; }).join(', ');
                    console.warn('buildPayload: ✗ Customer ' + soldToParty + ' NOT assigned to ' +
                                salesAreaMatch.vkorg + '/' + salesAreaMatch.vtweg +
                                '. Customer sales areas: [' + custSAList + ']. Searching for valid alternative with brand=' + brandUC + '...');

                    // Priority 1: Find intersection of customer SA + salesAreaMap with SAME BRAND
                    var foundAlt = false;
                    if (brandUC) {
                        for (var ca = 0; ca < customerSalesAreas.length && !foundAlt; ca++) {
                            var custSA = customerSalesAreas[ca];
                            for (var sl2 = 0; sl2 < salesAreaList.length; sl2++) {
                                var mapRow = salesAreaList[sl2];
                                var mapVkorg = String(mapRow.Vkorg || mapRow.VKORG || '').trim();
                                var mapVtweg = String(mapRow.Vtweg || mapRow.VTWEG || '').trim();
                                var mapBukrs = String(mapRow.Bukrs || mapRow.BUKRS || '').trim();
                                var mapBrand = String(mapRow.Brand || mapRow.BRAND || '').trim().toUpperCase();
                                if (custSA.vkorg === mapVkorg && custSA.vtweg === mapVtweg &&
                                    mapBrand === brandUC &&
                                    (!companyCode || mapBukrs === companyCode)) {
                                    salesAreaMatch.vkorg = mapVkorg;
                                    salesAreaMatch.vtweg = mapVtweg;
                                    salesAreaMatch.spart = custSA.spart || String(mapRow.Spart || mapRow.SPART || '').trim();
                                    salesAreaMatch.plant = String(mapRow.Site || mapRow.SITE || mapRow.Werks || mapRow.WERKS || '').trim();
                                    console.log('buildPayload: ✓ Found brand-compatible alternative → VKORG=' +
                                               salesAreaMatch.vkorg + ' VTWEG=' + salesAreaMatch.vtweg +
                                               ' SPART=' + salesAreaMatch.spart + ' Plant=' + salesAreaMatch.plant +
                                               ' Brand=' + mapBrand);
                                    foundAlt = true;
                                    break;
                                }
                            }
                        }
                    }

                    // Priority 2: Find intersection of customer SA + salesAreaMap (any brand, same BUKRS)
                    if (!foundAlt) {
                        console.log('buildPayload: No brand-compatible alternative. Trying any brand match...');
                        for (var ca2 = 0; ca2 < customerSalesAreas.length && !foundAlt; ca2++) {
                            var custSA2 = customerSalesAreas[ca2];
                            for (var sl3 = 0; sl3 < salesAreaList.length; sl3++) {
                                var mapRow2 = salesAreaList[sl3];
                                var mapVkorg2 = String(mapRow2.Vkorg || mapRow2.VKORG || '').trim();
                                var mapVtweg2 = String(mapRow2.Vtweg || mapRow2.VTWEG || '').trim();
                                var mapBukrs2 = String(mapRow2.Bukrs || mapRow2.BUKRS || '').trim();
                                if (custSA2.vkorg === mapVkorg2 && custSA2.vtweg === mapVtweg2 &&
                                    (!companyCode || mapBukrs2 === companyCode)) {
                                    salesAreaMatch.vkorg = mapVkorg2;
                                    salesAreaMatch.vtweg = mapVtweg2;
                                    salesAreaMatch.spart = custSA2.spart || String(mapRow2.Spart || mapRow2.SPART || '').trim();
                                    salesAreaMatch.plant = String(mapRow2.Site || mapRow2.SITE || mapRow2.Werks || mapRow2.WERKS || '').trim();
                                    var altBrand = String(mapRow2.Brand || mapRow2.BRAND || '').trim();
                                    console.warn('buildPayload: ⚠ Using non-brand-matching alternative → VKORG=' +
                                               salesAreaMatch.vkorg + ' VTWEG=' + salesAreaMatch.vtweg +
                                               ' SPART=' + salesAreaMatch.spart + ' Plant=' + salesAreaMatch.plant +
                                               ' MapBrand=' + altBrand + ' (product brand=' + brandUC + ')');
                                    foundAlt = true;
                                    break;
                                }
                            }
                        }
                    }

                    if (!foundAlt) {
                        // No intersection found at all - keep original brand-based SA and log error
                        console.error('buildPayload: ✗ NO VALID INTERSECTION: Customer ' + soldToParty +
                                     ' sales areas [' + custSAList + '] have no match in salesAreaMap.' +
                                     ' Keeping brand-based SA: ' + salesAreaMatch.vkorg + '/' + salesAreaMatch.vtweg);
                    }
                    console.log('SalesArea ADJUSTED → VKORG:' + salesAreaMatch.vkorg + ' VTWEG:' + salesAreaMatch.vtweg +
                               ' SPART:' + salesAreaMatch.spart + ' Plant:' + salesAreaMatch.plant);
                }
            } else {
                console.warn('buildPayload: Could not look up customer sales areas for ' + soldToParty + ', proceeding with current selection');
            }
        }

        var itemsArray = [];
        var errors = [];

        for (var i = 0; i < lineItems.length; i++) {
            var line = lineItems[i];
            var barcode2 = String(getField(line, 'barcode')).replace(/\s/g, '').replace(/^0+/, '');
            var description = String(getField(line, 'description') || '').trim();
            var quantity = getField(line, 'quantity');
            var unitPrice = getField(line, 'unitPrice');

            if (!barcode2 && description.length > 100) continue;

            var material = '';
            if (barcode2 && eanProductMap[barcode2]) material = eanProductMap[barcode2].material;
            if (!material) {
                errors.push('Row ' + (i + 1) + ': Material not found (barcode: ' + barcode2 + ')');
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
    function findSalesArea(salesAreaList, companyCode, matkl_fam, productBrand) {
        var result = { vkorg: '', vtweg: '', spart: '', plant: '' };
        if (!salesAreaList || salesAreaList.length === 0 || !companyCode) {
            console.log('findSalesArea: empty list or no companyCode');
            return result;
        }
        var brandUpper = (productBrand || '').trim().toUpperCase();
        console.log('findSalesArea: BUKRS=' + companyCode + ' MATKL_FAM=' + (matkl_fam || 'N/A') +
                    ' Brand=' + (brandUpper || 'N/A') + ' in ' + salesAreaList.length + ' rows');

        // 1) Best match: BUKRS + MATKL_FAM + Brand
        if (matkl_fam && brandUpper) {
            for (var i = 0; i < salesAreaList.length; i++) {
                var row = salesAreaList[i];
                var rowBukrs = String(row.Bukrs || row.BUKRS || '').trim();
                var rowMatkl = String(row.MatklFam || row.MATKL_FAM || '').trim();
                var rowBrand = String(row.Brand || row.BRAND || '').trim().toUpperCase();
                if (rowBukrs === companyCode && rowMatkl === matkl_fam && rowBrand === brandUpper) {
                    result.vkorg = String(row.Vkorg || row.VKORG || '').trim();
                    result.vtweg = String(row.Vtweg || row.VTWEG || '').trim();
                    result.spart = String(row.Spart || row.SPART || '').trim();
                    result.plant = String(row.Site || row.SITE || row.Werks || row.WERKS || '').trim();
                    console.log('findSalesArea: ✓ BUKRS+MATKL+BRAND MATCH row ' + i +
                               ' Brand=' + rowBrand + ' BUKRS=' + rowBukrs +
                               ' MATKL_FAM=' + rowMatkl + ' VKORG=' + result.vkorg);
                    if (result.vkorg) return result;
                }
            }
            console.log('findSalesArea: No BUKRS+MATKL+BRAND match...');
        }

        // 2) Match: BUKRS + Brand (ignore MATKL_FAM)
        if (brandUpper) {
            for (var b = 0; b < salesAreaList.length; b++) {
                var rowB = salesAreaList[b];
                var rowBukrsB = String(rowB.Bukrs || rowB.BUKRS || '').trim();
                var rowBrandB = String(rowB.Brand || rowB.BRAND || '').trim().toUpperCase();
                if (rowBukrsB === companyCode && rowBrandB === brandUpper) {
                    result.vkorg = String(rowB.Vkorg || rowB.VKORG || '').trim();
                    result.vtweg = String(rowB.Vtweg || rowB.VTWEG || '').trim();
                    result.spart = String(rowB.Spart || rowB.SPART || '').trim();
                    result.plant = String(rowB.Site || rowB.SITE || rowB.Werks || rowB.WERKS || '').trim();
                    console.log('findSalesArea: ✓ BUKRS+BRAND MATCH row ' + b +
                               ' Brand=' + rowBrandB + ' BUKRS=' + rowBukrsB + ' VKORG=' + result.vkorg);
                    if (result.vkorg) return result;
                }
            }
            console.log('findSalesArea: No BUKRS+BRAND match...');
        }

        // 3) Match: BUKRS + MATKL_FAM (ignore brand)
        if (matkl_fam) {
            for (var i2 = 0; i2 < salesAreaList.length; i2++) {
                var row2 = salesAreaList[i2];
                var rowBukrs2 = String(row2.Bukrs || row2.BUKRS || '').trim();
                var rowMatkl2 = String(row2.MatklFam || row2.MATKL_FAM || '').trim();
                if (rowBukrs2 === companyCode && rowMatkl2 === matkl_fam) {
                    result.vkorg = String(row2.Vkorg || row2.VKORG || '').trim();
                    result.vtweg = String(row2.Vtweg || row2.VTWEG || '').trim();
                    result.spart = String(row2.Spart || row2.SPART || '').trim();
                    result.plant = String(row2.Site || row2.SITE || row2.Werks || row2.WERKS || '').trim();
                    console.log('findSalesArea: ✓ BUKRS+MATKL MATCH row ' + i2 +
                               ' Brand=' + (row2.Brand || '') + ' BUKRS=' + rowBukrs2 +
                               ' MATKL_FAM=' + rowMatkl2 + ' VKORG=' + result.vkorg);
                    if (result.vkorg) return result;
                }
            }
            console.log('findSalesArea: No BUKRS+MATKL match...');
        }

        // 4) Fallback: Brand match across all BUKRS (company code mismatch)
        if (brandUpper) {
            for (var fb = 0; fb < salesAreaList.length; fb++) {
                var rowFB = salesAreaList[fb];
                var rowBrandFB = String(rowFB.Brand || rowFB.BRAND || '').trim().toUpperCase();
                if (rowBrandFB === brandUpper) {
                    result.vkorg = String(rowFB.Vkorg || rowFB.VKORG || '').trim();
                    result.vtweg = String(rowFB.Vtweg || rowFB.VTWEG || '').trim();
                    result.spart = String(rowFB.Spart || rowFB.SPART || '').trim();
                    result.plant = String(rowFB.Site || rowFB.SITE || rowFB.Werks || rowFB.WERKS || '').trim();
                    console.log('findSalesArea: ✓ BRAND-ONLY MATCH (fallback) row ' + fb +
                               ' Brand=' + rowBrandFB + ' BUKRS=' + String(rowFB.Bukrs || rowFB.BUKRS || '') +
                               ' VKORG=' + result.vkorg);
                    if (result.vkorg) return result;
                }
            }
            console.log('findSalesArea: No BRAND-only match...');
        }

        // 5) Last resort: BUKRS-only match (first found)
        for (var k = 0; k < salesAreaList.length; k++) {
            var row3 = salesAreaList[k];
            if (String(row3.Bukrs || row3.BUKRS || '').trim() === companyCode) {
                result.vkorg = String(row3.Vkorg || row3.VKORG || '').trim();
                result.vtweg = String(row3.Vtweg || row3.VTWEG || '').trim();
                result.spart = String(row3.Spart || row3.SPART || '').trim();
                result.plant = String(row3.Site || row3.SITE || row3.Werks || row3.WERKS || '').trim();
                console.log('findSalesArea: ✓ BUKRS-only match (last resort) Brand=' +
                           (row3.Brand || 'N/A') + ' VKORG=' + result.vkorg);
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