// srv/ocr-service.js

const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

module.exports = cds.service.impl(async function () {

    // ============================================================
    // lookupShipToPartner → AYNI KALIR
    // ============================================================
    this.on('lookupShipToPartner', async (req) => {
        try {
            console.log('=== lookupShipToPartner called ===');

            var ocrCompany = req.data.ocrCompany;
            if (!ocrCompany) {
                throw new Error('ocrCompany parameter is required');
            }

            console.log('Looking up Ship-To Partner for OCR Company: ' + ocrCompany);

            var url = "/sap/opu/odata4/sap/zsdocr_sb_shp_prt/srvd/sap/zsdocr_sd_shp_prt/0001/ShipToPartner"
                + "?$filter=" + encodeURIComponent("Company eq '" + ocrCompany + "'")
                + "&$format=json";

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
            console.log('Found ' + results.length + ' matching records');

            if (results.length === 0) {
                return {
                    shipToId: null,
                    shipToAddress: null,
                    success: false,
                    message: 'No Ship-To Partner found for OCR Company: ' + ocrCompany
                };
            }

            var match = results[0];
            console.log('Ship-To ID: ' + match.ShipToId + ', Address: ' + match.ShipToAddress);

            return {
                shipToId: match.ShipToId,
                shipToAddress: match.ShipToAddress,
                success: true,
                message: 'Ship-To Partner found for ' + ocrCompany
            };

        } catch (error) {
            console.error('lookupShipToPartner Error: ' + error.message);

            var errorMsg = 'Unknown error';
            if (error.response?.data?.error?.message?.value) {
                errorMsg = error.response.data.error.message.value;
            } else if (error.message) {
                errorMsg = error.message;
            }

            return {
                shipToId: null,
                shipToAddress: null,
                success: false,
                message: 'Failed: ' + errorMsg
            };
        }
    });


    // ============================================================
    // processAndCreateSalesOrder → TEK BİRLEŞİK ACTION
    //
    // Eski adımları birleştirir:
    //   Extract EANs (script) → extractEansAndTaxId()
    //   lookupProducts (CAP)  → lookupProducts()
    //   Barcode Check (script) → checkBarcodes()
    //   lookupBusinessPartner (CAP) → lookupBusinessPartner()
    //   Map OCR Response (script)   → buildPayload()
    //   createSalesOrder (CAP)      → createSalesOrder()
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
            var ocrCompany = stsa.ocrCompany || stsa.company || '';
            var overrides = getProcessOverrides(processName);

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
            var bpData = await lookupBusinessPartner(taxId);
            console.log('[' + processName + '] SoldTo:' + bpData.partner + ' BUKRS:' + bpData.companyCode);

            // --- Step 5: Build Payload ---
            var payload = buildPayload(data, eanProductMap, {
                soldToParty: bpData.partner,
                companyCode: bpData.companyCode,
                salesAreaList: salesAreaList,
                shipToList: shipToList,
                ocrCompany: ocrCompany,
                overrides: overrides
            });

            var errors = payload._errors;
            delete payload._errors;

            console.log('[' + processName + '] Payload: SOType=' + payload.SalesOrderType +
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
    // EXTRACT EANS & TAX ID
    // extractedData içindeki lineItemFields'den EAN'ları,
    // headerFields'den taxId'yi çıkarır
    // ============================================================
    function extractEansAndTaxId(data) {
        var eans = [];
        var seen = {};
        var taxId = '';

        // Header'dan taxId
        taxId = getField(data.headerFields, 'taxId')
            || getField(data.headerFields, 'vatNumber')
            || getField(data.headerFields, 'taxNumber')
            || '';
        taxId = taxId.replace(/\s/g, '').trim();

        // Line item'lardan EAN topla
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
    // EAN listesi ile API_PRODUCT_SRV'den ürün bilgisi çeker
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
    // LOOKUP BUSINESS PARTNER
    // TaxId ile API_BUSINESS_PARTNER'den BP bilgisi çeker
    // ============================================================
    async function lookupBusinessPartner(taxId) {
        if (!taxId) return { partner: '', companyCode: '' };

        try {
            var url = "/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartnerTaxNumber"
                + "?$filter=" + encodeURIComponent("BPTaxNumber eq '" + taxId + "'")
                + "&$select=BusinessPartner,BPTaxNumber"
                + "&$format=json";

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

            if (results.length > 0) {
                var bp = results[0].BusinessPartner;
                console.log('Business Partner found: ' + bp);
                return {
                    partner: bp || '',
                    companyCode: ''
                };
            }

            console.log('No BP found for taxId: ' + taxId);
            return { partner: '', companyCode: '' };

        } catch (e) {
            console.error('BP lookup error: ' + e.message);
            return { partner: '', companyCode: '' };
        }
    }


    // ============================================================
    // CREATE SALES ORDER
    // S/4HANA API_SALES_ORDER_SRV'ye POST yapar
    // ============================================================
    async function createSalesOrder(soPayload) {
        // Validasyon
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

        // Item validasyonu
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
    // OCR verisini + ürün map + BP + sales area bilgilerini
    // birleştirerek S/4 HANA Sales Order payload'ı oluşturur
    // ============================================================
    function buildPayload(data, eanProductMap, ctx) {
        var soldToParty = ctx.soldToParty;
        var companyCode = ctx.companyCode;
        var salesAreaList = ctx.salesAreaList;
        var shipToList = ctx.shipToList;
        var ocrCompany = ctx.ocrCompany;
        var overrides = ctx.overrides;

        // Header fields
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

        // SO Type belirleme
        var eligible1SHD = ['carrefour', 'emaxhtml', 'retail', 'lulu', 'sharafdg', 'eros'];
        var companyLower = ocrCompany.toLowerCase();
        var isEligible = false;
        for (var e = 0; e < eligible1SHD.length; e++) {
            if (companyLower.indexOf(eligible1SHD[e]) >= 0) {
                isEligible = true;
                break;
            }
        }
        var hasAddress = !!deliveryAddress;
        var soType = overrides.soType || ((isEligible && hasAddress) ? '1SHD' : '1SSR');

        // Ship To Party bul
        var shipToId = findShipTo(receiverId, hdr, shipToList);

        // Line Items
        var lineItems = data.lineItemFields || [];
        var itemsArray = [];
        var errors = [];
        var firstSalesArea = null;

        for (var i = 0; i < lineItems.length; i++) {
            var line = lineItems[i];
            var barcode = String(getField(line, 'barcode')).replace(/\s/g, '').replace(/^0+/, '');
            var description = String(getField(line, 'description') || '').trim();
            var quantity = getField(line, 'quantity');
            var unitPrice = getField(line, 'unitPrice');

            // Geçersiz barkod atla
            if (barcode && !/^\d+$/.test(barcode)) continue;
            // Çöp description atla
            if (!barcode && description.length > 100) continue;

            // Material bul - barkod ile (eanProductMap: { EAN: MaterialNumber })
            var material = '';

            if (barcode && eanProductMap[barcode]) {
                material = eanProductMap[barcode];
            }

            // Material bul - description ile (fallback)
            if (!material && description) {
                var eanKeys = Object.keys(eanProductMap);
                for (var j = 0; j < eanKeys.length; j++) {
                    // Bu basit map'te description yok, sadece barkod→material
                    // Description bazlı arama için genişletilmiş lookup gerekir
                    break;
                }
            }

            if (!material) {
                errors.push('Satır ' + (i + 1) + ': Malzeme bulunamadı (EAN: ' + barcode + ')');
                continue;
            }

            // Sales Area (Brand + BUKRS → VKORG, VTWEG, SPART, Site)
            var vkorg = '', vtweg = '', spart = '', plant = '';
            for (var sa = 0; sa < salesAreaList.length; sa++) {
                var saItem = salesAreaList[sa];
                var saBukrs = String(saItem.Bukrs || saItem.BUKRS || '');

                if (saBukrs === companyCode) {
                    vkorg = String(saItem.Vkorg || saItem.VKORG || '');
                    vtweg = String(saItem.Vtweg || saItem.VTWEG || '');
                    spart = String(saItem.Spart || saItem.SPART || '');
                    plant = String(saItem.Site || saItem.SITE || '');
                    break;
                }
            }

            if (!firstSalesArea && vkorg) {
                firstSalesArea = { org: vkorg, channel: vtweg, division: spart };
            }

            var itemObj = {
                Material: material,
                RequestedQuantity: String(quantity),
                ProductionPlant: plant
            };

            if (unitPrice) {
                itemObj.to_PricingElement = [{
                    ConditionType: overrides.conditionType || 'ZMAN',
                    ConditionRateValue: String(unitPrice)
                }];
            }

            itemsArray.push(itemObj);
        }

        if (!firstSalesArea) {
            firstSalesArea = { org: '', channel: '', division: '' };
        }

        // Partner
        var partnerArray = [];
        if (shipToId) {
            partnerArray.push({ PartnerFunction: 'WE', Customer: shipToId });
        }

        // Payload
        var payload = {
            SalesOrderType: soType,
            SalesOrganization: firstSalesArea.org,
            DistributionChannel: firstSalesArea.channel,
            OrganizationDivision: firstSalesArea.division,
            PurchaseOrderByCustomer: purchaseOrder,
            SoldToParty: soldToParty,
            to_Partner: partnerArray,
            to_Item: itemsArray,
            _errors: errors
        };

        if (poDate) {
            payload.CustomerPurchaseOrderDate = poDate + 'T00:00:00';
        }

        // 1SHD ise teslimat adresi alanlarını ekle
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
    // FIND SHIP TO
    // receiverId, adres ve fuzzy match ile ShipTo partner bulur
    // ============================================================
    function findShipTo(receiverId, headerFields, shipToList) {
        if (!shipToList || shipToList.length === 0) return '';

        var deliveryAddress = getField(headerFields, 'deliveryAdress');
        var deliveredTo = getField(headerFields, 'deliveredTo').trim();
        var deliveryLoc = getField(headerFields, 'deliveryLocation').trim();

        // 1) receiverId ile doğrudan eşleştir
        if (receiverId) {
            for (var s = 0; s < shipToList.length; s++) {
                var stId = String(shipToList[s].ShipTold || '');
                if (stId && stId.indexOf(receiverId) >= 0) {
                    return stId;
                }
            }
        }

        // 2) Text bazlı tam eşleştirme
        var searchTexts = [];
        if (deliveredTo) searchTexts.push(deliveredTo.toLowerCase());
        if (deliveryAddress) searchTexts.push(deliveryAddress.toLowerCase());
        if (deliveryLoc) searchTexts.push(deliveryLoc.toLowerCase());

        if (searchTexts.length === 0) return '';

        for (var s2 = 0; s2 < shipToList.length; s2++) {
            var addr = String(shipToList[s2].ShipToAddress || '').toLowerCase().trim();
            if (!addr) continue;

            for (var t = 0; t < searchTexts.length; t++) {
                if (searchTexts[t].indexOf(addr) >= 0 || addr.indexOf(searchTexts[t]) >= 0) {
                    return String(shipToList[s2].ShipTold || '');
                }
            }
        }

        // 3) Fuzzy kelime bazlı eşleştirme
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
                    best = { id: String(shipToList[s3].ShipTold || ''), score: score };
                }
            }
        }

        return best.id;
    }


    // ============================================================
    // PROCESS OVERRIDES
    // Process bazlı farklılıkları yönetir
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
