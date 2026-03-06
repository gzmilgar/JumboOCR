// srv/ocr-service.js
const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

module.exports = cds.service.impl(async function () {
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
// CDS Parameters:
//   extractedData      : String
//   shipToAndSalesArea : String  → {shipToPartners, salesAreaMap, success, message}
//   processName        : String  → "Carrefour", "Sephora", etc.
// NOT: ocrCompany bu action'ın parametresi DEĞİL.
//      processName şirket adı olarak kullanılır.
// ============================================================
this.on('processAndCreateSalesOrder', async (req) => {
    var processName = req.data.processName || 'Unknown';
    try {
        console.log('=== processAndCreateSalesOrder called [' + processName + '] ===');

        // --- Parse inputs ---
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

        var salesAreaList = parseJsonField(stsa.salesAreaMap);
        var shipToList = parseJsonField(stsa.shipToPartners);
        var overrides = getProcessOverrides(processName);

        // Debug
        console.log('[' + processName + '] SalesAreaMap count: ' + salesAreaList.length);
        if (salesAreaList.length > 0) {
            console.log('[' + processName + '] SalesAreaMap keys: ' + Object.keys(salesAreaList[0]).join(', '));
            console.log('[' + processName + '] SalesAreaMap[0]: ' + JSON.stringify(salesAreaList[0]));
        }

        // ── SalesAreaMap'ten izin verilen BUKRS listesini çıkar ──
        var allowedBukrs = extractAllowedBukrs(salesAreaList);
        console.log('[' + processName + '] Allowed BUKRS from salesAreaMap: [' + allowedBukrs.join(', ') + ']');

        // --- Step 1: Extract EANs & TaxId ---
        var extracted = extractEansAndTaxId(data);
        var eans = extracted.eans;
        var taxId = extracted.taxId;
        console.log('[' + processName + '] EANs:' + eans.length + ' TaxId:' + taxId);

        // --- Step 2: Lookup Products ---
        var eanProductMap = await lookupProducts(eans);
        console.log('[' + processName + '] Products:' + Object.keys(eanProductMap).length + '/' + eans.length);

        // --- Step 3: Barcode Check ---
        var barcodeReport = checkBarcodes(eans, eanProductMap);
        if (barcodeReport.missing.length > 0) {
            console.log('[' + processName + '] Missing barcodes: ' + barcodeReport.missing.join(', '));
        }

        // --- Step 4: Lookup Business Partner ---
        var bpData = await lookupBusinessPartner(taxId, allowedBukrs);
        console.log('[' + processName + '] BP Result → SoldTo:' + bpData.partner +
            ' BUKRS:' + bpData.companyCode + ' TaxNum:' + bpData.bpTaxNumber);

        if (!bpData.partner) {
            return {
                salesOrderNumber: null,
                message: 'Business Partner not found for Tax ID: ' + taxId,
                success: false,
                itemCount: 0,
                missingBarcodes: barcodeReport.missing.join(',')
            };
        }

        if (!bpData.companyCode) {
            console.warn('[' + processName + '] WARNING: No matching BUKRS in salesAreaMap for BP: ' + bpData.partner);
        }

        // --- Step 5: Build Payload ---
        var payload = buildPayload(data, eanProductMap, {
            soldToParty: bpData.partner,
            companyCode: bpData.companyCode,
            salesAreaList: salesAreaList,
            shipToList: shipToList,
            processName: processName,
            overrides: overrides
        });
        var errors = payload._errors;
        delete payload._errors;
        console.log('[' + processName + '] Payload: SOType=' + payload.SalesOrderType +
            ' SalesOrg=' + payload.SalesOrganization +
            ' DistCh=' + payload.DistributionChannel +
            ' Div=' + payload.OrganizationDivision +
            ' Items=' + payload.to_Item.length + ' Errors=' + errors.length);

        // --- Step 6: Create Sales Order ---
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
// EXTRACT ALLOWED BUKRS FROM SALES AREA MAP
// ============================================================
function extractAllowedBukrs(salesAreaList) {
    if (!salesAreaList || salesAreaList.length === 0) return [];

    var bukrsSet = {};
    for (var i = 0; i < salesAreaList.length; i++) {
        var bukrs = String(salesAreaList[i].Bukrs || salesAreaList[i].BUKRS || '').trim();
        if (bukrs) {
            bukrsSet[bukrs] = true;
        }
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
        if (eanProductMap[eans[i]]) {
            found.push(eans[i]);
        } else {
            missing.push(eans[i]);
        }
    }
    return {
        total: eans.length,
        found: found,
        missing: missing,
        matchRate: eans.length > 0
            ? Math.round((found.length / eans.length) * 100)
            : 0
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
            + "&$select=Product,ProductStandardID"
            + "&$format=json";
        try {
            var response = await executeHttpRequest(
                { destinationName: 'QS4_HTTPS' },
                {
                    method: 'GET',
                    url: url,
                    headers: { 'Accept': 'application/json' },
                    timeout: 30000
                }
            );
            var results = response.data?.d?.results || [];
            for (var r = 0; r < results.length; r++) {
                var row = results[r];
                var ean = String(row.ProductStandardID || '').replace(/^0+/, '');
                if (ean) {
                    productMap[ean] = row.Product || '';
                }
            }
        } catch (e) {
            console.error('Product lookup batch error: ' + e.message);
        }
    }
    return productMap;
}

// ============================================================
// LOOKUP BUSINESS PARTNER (Multi-BP + Dinamik BUKRS)
// ============================================================
async function lookupBusinessPartner(taxId, allowedBukrs) {
    if (!taxId) return { partner: '', bpTaxNumber: '', companyCode: '' };

    var hasFilter = allowedBukrs && allowedBukrs.length > 0;

    try {
        // ── Adım 1: Tax ID → TÜM BusinessPartner'ları bul ──
        var url1 = "/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartnerTaxNumber"
            + "?$filter=" + encodeURIComponent("BPTaxNumber eq '" + taxId + "'")
            + "&$select=BusinessPartner,BPTaxNumber"
            + "&$format=json";

        var response1 = await executeHttpRequest(
            { destinationName: 'QS4_HTTPS' },
            {
                method: 'GET',
                url: url1,
                headers: { 'Accept': 'application/json' },
                timeout: 30000
            }
        );

        var bpResults = response1.data?.d?.results || [];
        console.log('Tax ID: ' + taxId + ' → BP count: ' + bpResults.length);

        if (bpResults.length === 0) {
            console.log('No BP found for taxId: ' + taxId);
            return { partner: '', bpTaxNumber: '', companyCode: '' };
        }

        for (var k = 0; k < bpResults.length; k++) {
            console.log('  BP[' + k + ']: ' + bpResults[k].BusinessPartner);
        }

        // ── Adım 2: Tüm BP'ler için TOPLU CompanyCode sorgula (KNB1) ──
        var bpFilterParts = bpResults.map(function (r) {
            return "Customer eq '" + r.BusinessPartner + "'";
        });
        var combinedFilter = bpFilterParts.join(' or ');

        var url2 = "/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_CustomerCompany"
            + "?$filter=" + encodeURIComponent(combinedFilter)
            + "&$select=Customer,CompanyCode"
            + "&$format=json";

        var response2 = await executeHttpRequest(
            { destinationName: 'QS4_HTTPS' },
            {
                method: 'GET',
                url: url2,
                headers: { 'Accept': 'application/json' },
                timeout: 30000
            }
        );

        var companyResults = response2.data?.d?.results || [];
        console.log('KNB1 results: ' + companyResults.length);

        for (var c = 0; c < companyResults.length; c++) {
            var inMap = hasFilter ? (allowedBukrs.indexOf(companyResults[c].CompanyCode) >= 0) : true;
            console.log('  KUNNR: ' + companyResults[c].Customer +
                ' → BUKRS: ' + companyResults[c].CompanyCode +
                (inMap ? ' ✓ in salesAreaMap' : ' ✗ not in salesAreaMap'));
        }

        // ── Adım 3: salesAreaMap'teki BUKRS ile eşleşen ilk kaydı bul ──
        if (hasFilter) {
            for (var i = 0; i < companyResults.length; i++) {
                var customer = companyResults[i].Customer;
                var companyCode = companyResults[i].CompanyCode;

                if (allowedBukrs.indexOf(companyCode) >= 0) {
                    var matchedBp = null;
                    for (var m = 0; m < bpResults.length; m++) {
                        if (bpResults[m].BusinessPartner === customer) {
                            matchedBp = bpResults[m];
                            break;
                        }
                    }

                    console.log('✓ MATCH → PARTNER: ' + customer +
                        ', BUKRS: ' + companyCode +
                        ', TaxNum: ' + (matchedBp ? matchedBp.BPTaxNumber : taxId));

                    return {
                        partner: customer,
                        bpTaxNumber: matchedBp ? matchedBp.BPTaxNumber : taxId,
                        companyCode: companyCode
                    };
                }
            }

            console.log('✗ WARNING: KNB1 BUKRS [' +
                companyResults.map(function (r) { return r.CompanyCode; }).join(', ') +
                '] did not match salesAreaMap BUKRS [' + allowedBukrs.join(', ') + ']');
        }

        // ── Adım 4: Fallback ──
        console.log('Fallback: using first BP: ' + bpResults[0].BusinessPartner);

        var fallbackCompanyCode = '';
        for (var f = 0; f < companyResults.length; f++) {
            if (companyResults[f].Customer === bpResults[0].BusinessPartner) {
                fallbackCompanyCode = companyResults[f].CompanyCode;
                break;
            }
        }

        return {
            partner: bpResults[0].BusinessPartner,
            bpTaxNumber: bpResults[0].BPTaxNumber,
            companyCode: fallbackCompanyCode
        };

    } catch (e) {
        console.error('BP lookup error: ' + e.message);
        return { partner: '', bpTaxNumber: '', companyCode: '' };
    }
}

// ============================================================
// CREATE SALES ORDER
// ============================================================
async function createSalesOrder(soPayload) {
    var requiredFields = [
        'SalesOrderType',
        'SalesOrganization',
        'DistributionChannel',
        'OrganizationDivision',
        'SoldToParty'
    ];
    var missing = requiredFields.filter(function (f) { return !soPayload[f]; });
    if (missing.length > 0) {
        throw new Error('Missing required header fields: ' + missing.join(', '));
    }
    if (!soPayload.to_Item || soPayload.to_Item.length === 0) {
        throw new Error('Missing line items (to_Item)');
    }
    soPayload.to_Item.forEach(function (item, idx) {
        var itemNo = item.SalesOrderItem || ((idx + 1) * 10);
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
    console.log('  Items: ' + soPayload.to_Item.length);
    if (soPayload.to_Item.length > 0) {
        console.log('  Item[0] Plant: ' + (soPayload.to_Item[0].ProductionPlant || 'N/A'));
    }
    console.log('==================');

    var response = await executeHttpRequest(
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
    var salesOrder = response.data?.d?.SalesOrder;
    if (!salesOrder) {
        throw new Error('No SalesOrder number in S/4HANA response');
    }
    return { salesOrder: salesOrder };
}

// ============================================================
// BUILD PAYLOAD
// ============================================================
function buildPayload(data, eanProductMap, ctx) {
    var soldToParty = ctx.soldToParty;
    var companyCode = ctx.companyCode;
    var salesAreaList = ctx.salesAreaList;
    var shipToList = ctx.shipToList;
    var processName = ctx.processName || '';
    var overrides = ctx.overrides;

    var hdr = data.headerFields;
    var purchaseOrder = getField(hdr, 'purchaseOrder');
    var poDate = getField(hdr, 'documentDate');
    var deliveryAddress = getField(hdr, 'deliveryAdress');
    var receiverId = getField(hdr, 'receiverId');
    var deliveryName = getField(hdr, 'deliveryName');
    var deliveryPhone = getField(hdr, 'deliveryPhone') || getField(hdr, 'telephone');
    var deliveryCity = getField(hdr, 'deliveryCity');
    var deliveryPostalCode = getField(hdr, 'deliveryPostalCode');
    var deliveryCountry = getField(hdr, 'deliveryCountry');

    var eligible1SHD = ['carrefour', 'emaxhtml', 'retail', 'lulu', 'sharafdg', 'eros'];
    var companyLower = processName.toLowerCase();
    console.log('buildPayload: processName=' + processName + ' companyLower=' + companyLower);

    var isEligible = false;
    for (var e = 0; e < eligible1SHD.length; e++) {
        if (companyLower.indexOf(eligible1SHD[e]) >= 0) {
            isEligible = true;
            break;
        }
    }
    var hasAddress = !!deliveryAddress;
    var soType = overrides.soType || ((isEligible && hasAddress) ? '1SHD' : '1SSR');
    console.log('buildPayload: isEligible=' + isEligible + ' hasAddress=' + hasAddress + ' soType=' + soType);

    var shipToId = findShipTo(receiverId, hdr, shipToList);
    console.log('buildPayload: shipToId=' + shipToId);

    var salesAreaMatch = findSalesArea(salesAreaList, companyCode);
    console.log('SalesArea for BUKRS=' + companyCode + ' → ' +
        'VKORG:' + salesAreaMatch.vkorg +
        ' VTWEG:' + salesAreaMatch.vtweg +
        ' SPART:' + salesAreaMatch.spart +
        ' Plant:' + salesAreaMatch.plant);

    var lineItems = data.lineItemFields || [];
    var itemsArray = [];
    var errors = [];

    for (var i = 0; i < lineItems.length; i++) {
        var line = lineItems[i];
        var barcode = String(getField(line, 'barcode')).replace(/\s/g, '').replace(/^0+/, '');
        var description = String(getField(line, 'description') || '').trim();
        var quantity = getField(line, 'quantity');
        var unitPrice = getField(line, 'unitPrice');

        if (barcode && !/^\d+$/.test(barcode)) continue;
        if (!barcode && description.length > 100) continue;

        var material = '';
        if (barcode && eanProductMap[barcode]) {
            material = eanProductMap[barcode];
        }
        if (!material && description) {
            var eanKeys = Object.keys(eanProductMap);
            for (var j = 0; j < eanKeys.length; j++) {
                break;
            }
        }
        if (!material) {
            errors.push('Satır ' + (i + 1) + ': Malzeme bulunamadı (EAN: ' + barcode + ')');
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
    if (shipToId) {
        partnerArray.push({ PartnerFunction: 'WE', Customer: shipToId });
    }

    var payload = {
        SalesOrderType: soType,
        SalesOrganization: salesAreaMatch.vkorg,
        DistributionChannel: salesAreaMatch.vtweg,
        OrganizationDivision: salesAreaMatch.spart,
        PurchaseOrderByCustomer: purchaseOrder,
        SoldToParty: soldToParty,
        to_Partner: partnerArray,
        to_Item: itemsArray
    };
    
    if (soType === '1SHD') {
        payload.ZZ8_SOUPD_01_SDH = deliveryName;
        payload.ZZ8_SOUPD_02_SDH = deliveryAddress;
        payload.ZZ8_SOUPD_03_SDH = deliveryCity;
        payload.ZZ8_SOUPD_04_SDH = deliveryPostalCode;
        payload.ZZ8_SOUPD_05_SDH = deliveryCountry;
        payload.ZZ8_SOUPD_06_SDH = deliveryPhone;
    }
    return payload;
}

// ============================================================
// FIND SALES AREA (ZSD_V_SAREA_MAP → BUKRS ile eşleştir)
// ============================================================
// Field isimleri (debug'dan doğrulandı):
//   Brand, Bukrs, Vkorg, Vtweg, Spart, Site, ParentKey
// ============================================================
function findSalesArea(salesAreaList, companyCode) {
    var result = { vkorg: '', vtweg: '', spart: '', plant: '' };

    if (!salesAreaList || salesAreaList.length === 0 || !companyCode) {
        console.log('findSalesArea: empty list or no companyCode');
        return result;
    }

    console.log('findSalesArea: searching BUKRS=' + companyCode + ' in ' + salesAreaList.length + ' rows');

    for (var i = 0; i < salesAreaList.length; i++) {
        var row = salesAreaList[i];
        var rowBukrs = String(row.Bukrs || row.BUKRS || '').trim();

        if (rowBukrs === companyCode) {
            result.vkorg = String(row.Vkorg || row.VKORG || '').trim();
            result.vtweg = String(row.Vtweg || row.VTWEG || '').trim();
            result.spart = String(row.Spart || row.SPART || '').trim();
            result.plant = String(row.Site || row.SITE || row.Werks || row.WERKS || '').trim();

            console.log('findSalesArea: ✓ MATCH row ' + i +
                ' → Brand:' + (row.Brand || '') +
                ' BUKRS:' + rowBukrs +
                ' VKORG:' + result.vkorg +
                ' VTWEG:' + result.vtweg +
                ' SPART:' + result.spart +
                ' Site:' + result.plant);

            if (result.vkorg) {
                return result;
            } else {
                console.log('findSalesArea: VKORG empty, checking next row with same BUKRS...');
            }
        }
    }

    if (result.plant || result.vtweg || result.spart) {
        console.log('findSalesArea: returning partial match (VKORG may be empty)');
        return result;
    }

    var uniqueBukrs = [];
    var seen = {};
    for (var u = 0; u < salesAreaList.length; u++) {
        var b = String(salesAreaList[u].Bukrs || salesAreaList[u].BUKRS || '');
        if (b && !seen[b]) {
            seen[b] = true;
            uniqueBukrs.push(b);
        }
    }
    console.log('findSalesArea: ✗ No match for BUKRS=' + companyCode +
        '. Available: [' + uniqueBukrs.join(', ') + ']');

    return result;
}

// ============================================================
// FIND SHIP TO
// ============================================================
// ShipToList field isimleri (debug'dan doğrulandı):
//   Company, ShipToAddress, ShipToId, ParentKey
// ============================================================
function findShipTo(receiverId, headerFields, shipToList) {
    if (!shipToList || shipToList.length === 0) return '';

    var deliveryAddress = getField(headerFields, 'deliveryAdress');
    var deliveredTo = getField(headerFields, 'deliveredTo').trim();
    var deliveryLoc = getField(headerFields, 'deliveryLocation').trim();

    // 1) receiverId ile tam eşleşme
    if (receiverId) {
        for (var s = 0; s < shipToList.length; s++) {
            var stId = String(shipToList[s].ShipToId || '');
            if (stId && stId.indexOf(receiverId) >= 0) {
                console.log('findShipTo: receiverId match → ShipToId: ' + stId);
                return stId;
            }
        }
    }

    // 2) Adres ile tam eşleşme
    var searchTexts = [];
    if (deliveryAddress) searchTexts.push(deliveryAddress.toLowerCase());
    if (searchTexts.length === 0) return '';

    for (var s2 = 0; s2 < shipToList.length; s2++) {
        var addr = String(shipToList[s2].ShipToAddress || '').toLowerCase().trim();
        if (!addr) continue;
        for (var t = 0; t < searchTexts.length; t++) {
            if (searchTexts[t].indexOf(addr) >= 0 || addr.indexOf(searchTexts[t]) >= 0) {
                var matchId = String(shipToList[s2].ShipToId || '');
                console.log('findShipTo: address match → ShipToId: ' + matchId +
                    ' (addr: ' + addr + ')');
                return matchId;
            }
        }
    }

    // 3) Fuzzy match - kelime bazlı benzerlik
    var best = { id: '', score: 0 };
    for (var s3 = 0; s3 < shipToList.length; s3++) {
        var addr2 = String(shipToList[s3].ShipToAddress || '').toLowerCase().trim();
        if (!addr2) continue;
        var words = addr2.split(/\s+/);
        for (var t2 = 0; t2 < searchTexts.length; t2++) {
            var matchCount = 0;
            for (var w = 0; w < words.length; w++) {
                if (words[w].length > 2 && searchTexts[t2].indexOf(words[w]) >= 0) {
                    matchCount++;
                }
            }
            var score = words.length > 0 ? matchCount / words.length : 0;
            if (score > best.score && score >= 0.5) {
                best = { id: String(shipToList[s3].ShipToId || ''), score: score };
            }
        }
    }

    if (best.id) {
        console.log('findShipTo: fuzzy match → ShipToId: ' + best.id +
            ' (score: ' + best.score.toFixed(2) + ')');
    } else {
        console.log('findShipTo: no match found');
    }

    return best.id;
}

// ============================================================
// PROCESS OVERRIDES
// ============================================================
function getProcessOverrides(processName) {
    var map = {
        'Carrefour': { conditionType: 'ZMAN', soType: null },
        'Sephora': { conditionType: 'ZMAN', soType: '1SSR' },
        'Emax': { conditionType: 'ZMAN', soType: null },
        'Retail': { conditionType: 'ZMAN', soType: null },
        'Dyson': { conditionType: 'ZMAN', soType: '1SSR' },
        'VStart': { conditionType: 'ZMAN', soType: null }
    };
    return map[processName] || { conditionType: 'ZMAN', soType: null };
}

// ============================================================
// HELPERS
// ============================================================
function getField(obj, fieldName) {
    if (obj && obj[fieldName] && obj[fieldName].length > 0 &&
        obj[fieldName][0].value !== undefined) {
        return String(obj[fieldName][0].value);
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


});