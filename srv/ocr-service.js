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

            console.log('[' + processName + '] ShipToPartner count: ' + shipToList.length);
            if (shipToList.length > 0) {
                console.log('[' + processName + '] ShipToPartner keys: ' + Object.keys(shipToList[0]).join(', '));
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

            // --- Step 4: Build Payload (ASYNC - KNB1 lookup yapacak) ---
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

            // --- Step 5: Create Sales Order ---
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
            matchRate: eans.length > 0
                ? Math.round((found.length / eans.length) * 100)
                : 0
        };
    }

    // ============================================================
    // LOOKUP PRODUCTS (ProductGroup ile birlikte)
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
    // GET SOLD-TO COMPANY CODE (KNB1 - A_CustomerCompany)
    // ============================================================
    // SoldToParty → KNB1 → BUKRS (allowedBukrs ile match)
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
                {
                    method: 'GET',
                    url: url,
                    headers: { 'Accept': 'application/json' },
                    timeout: 30000
                }
            );

            var results = response.data?.d?.results || [];
            console.log('KNB1 results: ' + results.length);

            if (results.length === 0) {
                console.log('No company code found for SoldToParty: ' + soldToParty);
                return '';
            }

            // allowedBukrs ile eşleşeni bul
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
                    // allowedBukrs yoksa ilk BUKRS'i kullan
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
    // BUILD PAYLOAD (ASYNC - KNB1 Lookup)
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
        var deliveryAddress = getField(hdr, 'deliveryAdress');  // ShipTo matching için
        var vendorAddress = getField(hdr, 'vendorAdress');      // 1SHD kontrolü için
        var receiverId = getField(hdr, 'receiverId');
        var deliveryName = getField(hdr, 'deliveryName');
        var deliveryPhone = getField(hdr, 'deliveryPhone') || getField(hdr, 'telephone');
        var deliveryCity = getField(hdr, 'deliveryCity');
        var deliveryPostalCode = getField(hdr, 'deliveryPostalCode');
        var deliveryCountry = getField(hdr, 'deliveryCountry');

        // ── YENİ: 1SHD için vendorAddress kontrol et ──
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
            if (companyLower.indexOf(eligible1SHD[e]) >= 0) {
                isEligible = true;
                break;
            }
        }
        
        var soType = overrides.soType || ((isEligible && hasAddress) ? '1SHD' : '1SSR');
        
        console.log('buildPayload: isEligible=' + isEligible + 
                    ' hasAddress=' + hasAddress + 
                    ' override=' + (overrides.soType || 'null') +
                    ' → soType=' + soType);

        // ── findShipTo'dan SoldToParty al ──
        var shipToResult = findShipTo(receiverId, hdr, shipToList);
        console.log('buildPayload: ShipToId=' + shipToResult.shipToId +
                   ' SoldToParty=' + shipToResult.soldToParty +
                   ' Company=' + shipToResult.company);

        var soldToParty = shipToResult.soldToParty;
        
        // ── YENİ: SoldToParty → KNB1 → BUKRS ──
        var companyCode = '';
        if (soldToParty) {
            companyCode = await getSoldToCompanyCode(soldToParty, allowedBukrs);
            console.log('buildPayload: SoldToParty=' + soldToParty + 
                       ' → CompanyCode=' + companyCode);
        }
        
        if (!companyCode) {
            console.warn('buildPayload: No CompanyCode found for SoldToParty=' + soldToParty);
        }

        // ── İlk material'den MATKL_FAM belirle ──
        var lineItems = data.lineItemFields || [];
        var firstMaterial = null;
        var firstProductGroup = '';
        var matkl_fam = '';

        for (var m = 0; m < lineItems.length && !firstMaterial; m++) {
            var barcode = String(getField(lineItems[m], 'barcode'))
                .replace(/\s/g, '').replace(/^0+/, '');
            if (barcode && eanProductMap[barcode] && eanProductMap[barcode].material) {
                firstMaterial = eanProductMap[barcode].material;
                firstProductGroup = eanProductMap[barcode].productGroup || '';
                if (firstProductGroup.length >= 3) {
                    matkl_fam = firstProductGroup.substring(0, 3);
                }
                console.log('buildPayload: First Material=' + firstMaterial + 
                           ' ProductGroup=' + firstProductGroup + 
                           ' MATKL_FAM=' + matkl_fam);
                break;
            }
        }

        // ── SalesArea belirle (MATKL_FAM ile) ──
        var salesAreaMatch = findSalesArea(salesAreaList, companyCode, matkl_fam);
        
        console.log('SalesArea for BUKRS=' + companyCode + 
                   ' MATKL_FAM=' + (matkl_fam || 'N/A') +
                   ' → VKORG:' + salesAreaMatch.vkorg +
                   ' VTWEG:' + salesAreaMatch.vtweg +
                   ' SPART:' + salesAreaMatch.spart +
                   ' Plant:' + salesAreaMatch.plant);

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
            if (barcode2 && eanProductMap[barcode2]) {
                material = eanProductMap[barcode2].material;
            }
            if (!material && description) {
                var eanKeys = Object.keys(eanProductMap);
                for (var j = 0; j < eanKeys.length; j++) {
                    break;
                }
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
            SalesOrderType: soType,
            SalesOrganization: salesAreaMatch.vkorg,
            DistributionChannel: salesAreaMatch.vtweg,
            OrganizationDivision: salesAreaMatch.spart,
            PurchaseOrderByCustomer: purchaseOrder,
            SoldToParty: soldToParty,
            to_Partner: partnerArray,
            to_Item: itemsArray,
            _errors: errors,
            _soldToParty: soldToParty,
            _companyCode: companyCode
        };
        
        if (soType === '1SHD') {
            payload.ZZ8_SOUPD_01_SDH = deliveryName;
            payload.ZZ8_SOUPD_02_SDH = vendorAddress;  // ← YENİ: vendorAddress kullan
            payload.ZZ8_SOUPD_03_SDH = deliveryCity;
            payload.ZZ8_SOUPD_04_SDH = deliveryPostalCode;
            payload.ZZ8_SOUPD_05_SDH = deliveryCountry;
            payload.ZZ8_SOUPD_06_SDH = deliveryPhone;
        }
        return payload;
    }

    // ============================================================
    // FIND SALES AREA (MATKL_FAM + Brand Priority)
    // ============================================================
    // Field isimleri: Brand, Bukrs, Vkorg, Vtweg, Spart, Site, MatklFam
    // ============================================================
    function findSalesArea(salesAreaList, companyCode, matkl_fam) {
        var result = { vkorg: '', vtweg: '', spart: '', plant: '' };

        if (!salesAreaList || salesAreaList.length === 0 || !companyCode) {
            console.log('findSalesArea: empty list or no companyCode');
            return result;
        }

        console.log('findSalesArea: BUKRS=' + companyCode + 
                    ' MATKL_FAM=' + (matkl_fam || 'N/A') + 
                    ' in ' + salesAreaList.length + ' rows');

        // ── Öncelik 1: BUKRS + MATKL_FAM (tam eşleşme) ──
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
                               ' Brand=' + (row.Brand || '') +
                               ' BUKRS=' + rowBukrs +
                               ' MATKL_FAM=' + rowMatkl +
                               ' VKORG=' + result.vkorg);
                    
                    if (result.vkorg) return result;
                }
            }
            console.log('findSalesArea: No MATKL_FAM match, trying default...');
        }

        // ── Öncelik 2: BUKRS + Default (MATKL_FAM boş) + Brand="SON" öncelikli ──
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

        // SON brand'i öncelikli olarak ara
        for (var d = 0; d < defaultMatches.length; d++) {
            if (defaultMatches[d].brand === 'SON' && defaultMatches[d].vkorg) {
                result = {
                    vkorg: defaultMatches[d].vkorg,
                    vtweg: defaultMatches[d].vtweg,
                    spart: defaultMatches[d].spart,
                    plant: defaultMatches[d].plant
                };
                console.log('findSalesArea: ✓ DEFAULT MATCH (Brand=SON priority)' +
                           ' VKORG=' + result.vkorg);
                return result;
            }
        }

        // SON yoksa ilk default'u kullan
        if (defaultMatches.length > 0 && defaultMatches[0].vkorg) {
            result = {
                vkorg: defaultMatches[0].vkorg,
                vtweg: defaultMatches[0].vtweg,
                spart: defaultMatches[0].spart,
                plant: defaultMatches[0].plant
            };
            console.log('findSalesArea: ✓ DEFAULT MATCH (first found)' +
                       ' Brand=' + defaultMatches[0].brand +
                       ' VKORG=' + result.vkorg);
            return result;
        }

        // ── Öncelik 3: Sadece BUKRS (fallback) ──
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
    // FIND SHIP TO (SoldToParty + Company Döndürür)
    // ============================================================
    // RETURN: { shipToId, soldToParty, company }
    // Field isimleri: Company, ShipToAddress, ShipToId, SoldToParty
    // ============================================================
    function findShipTo(receiverId, headerFields, shipToList) {
        var emptyResult = { shipToId: '', soldToParty: '', company: '' };
        
        if (!shipToList || shipToList.length === 0) {
            console.log('findShipTo: empty shipToList');
            return emptyResult;
        }

        var deliveryAddress = getField(headerFields, 'deliveryAdress');
        
        console.log('findShipTo: receiverId=' + receiverId + 
                    ' deliveryAddress=' + deliveryAddress);

        // 1) receiverId ile tam eşleşme
        if (receiverId) {
            for (var s = 0; s < shipToList.length; s++) {
                var row = shipToList[s];
                var stId = String(row.ShipToId || '');
                
                if (stId && stId.indexOf(receiverId) >= 0) {
                    var result = {
                        shipToId: stId,
                        soldToParty: String(row.SoldToParty || '').trim(),
                        company: String(row.Company || '').trim()
                    };
                    console.log('findShipTo: receiverId match → ' + 
                               'ShipToId=' + result.shipToId +
                               ' SoldToParty=' + result.soldToParty +
                               ' Company=' + result.company);
                    return result;
                }
            }
        }

        // 2) Adres ile tam eşleşme
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
                    var result2 = {
                        shipToId: String(row2.ShipToId || ''),
                        soldToParty: String(row2.SoldToParty || '').trim(),
                        company: String(row2.Company || '').trim()
                    };
                    console.log('findShipTo: address match → ' +
                               'ShipToId=' + result2.shipToId +
                               ' SoldToParty=' + result2.soldToParty +
                               ' Company=' + result2.company +
                               ' (addr: ' + addr + ')');
                    return result2;
                }
            }
        }

        // 3) Fuzzy match - kelime bazlı benzerlik
        var best = { result: emptyResult, score: 0 };
        
        for (var s3 = 0; s3 < shipToList.length; s3++) {
            var row3 = shipToList[s3];
            var addr2 = String(row3.ShipToAddress || '').toLowerCase().trim();
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
                    best = { 
                        result: {
                            shipToId: String(row3.ShipToId || ''),
                            soldToParty: String(row3.SoldToParty || '').trim(),
                            company: String(row3.Company || '').trim()
                        }, 
                        score: score 
                    };
                }
            }
        }

        if (best.result.shipToId) {
            console.log('findShipTo: fuzzy match → ' +
                       'ShipToId=' + best.result.shipToId +
                       ' SoldToParty=' + best.result.soldToParty +
                       ' Company=' + best.result.company +
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

});