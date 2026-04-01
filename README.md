# JumboOCR - Purchase Order to Sales Order Automation

SAP BTP application that automates Sales Order creation in S/4HANA from Purchase Order PDFs received via email. Uses SAP Build Process Automation (BPA) for email monitoring and Document AI for PDF extraction, with a custom Fiori Elements UI for monitoring and re-triggering failed orders.

## Architecture

```
                        SAP Build Process Automation (BPA)
                        ┌─────────────────────────────────────────────┐
Outlook Mailbox ──────> │ 1. Get Email (PDF attachment)               │
  (PO PDFs)             │ 2. Extract Data (Document AI template)      │
                        │ 3. Map OCR Response                         │
                        │ 4. Call lookupShipToAndSalesArea             │
                        │ 5. Call processAndCreateSalesOrder           │
                        │ 6. Log result (success/failure)             │
                        └──────────────┬──────────────────────────────┘
                                       │ OData V4
                                       ▼
                        ┌─────────────────────────────────────────────┐
                        │         CAP OData Service (ocr-srv)         │
                        │                                             │
                        │  - ShipTo & Sales Area lookup               │
                        │  - Product lookup (EAN → Material)          │
                        │  - Sales Area mapping (Brand-based)         │
                        │  - Sales Order creation (API_SALES_ORDER)   │
                        │  - Log management (OCRLogHead CRUD)         │
                        └──────────────┬──────────────────────────────┘
                                       │ RFC / OData
                                       ▼
                        ┌─────────────────────────────────────────────┐
                        │              S/4HANA On-Premise             │
                        │                                             │
                        │  - API_SALES_ORDER_SRV (SO creation)        │
                        │  - API_BUSINESS_PARTNER (SoldTo lookup)     │
                        │  - API_PRODUCT_SRV (Material/EAN lookup)    │
                        │  - ZSDOCR custom OData (Log storage)        │
                        │  - ZSDOCR ShipTo/SalesArea mapping          │
                        └─────────────────────────────────────────────┘

                        ┌─────────────────────────────────────────────┐
                        │     Fiori Elements UI (OCR Log Trigger)     │
                        │                                             │
                        │  - List Report: all PO logs with filters    │
                        │  - Object Page: log detail + items          │
                        │  - Edit popup: modify header & item fields  │
                        │  - Trigger button: re-trigger failed logs   │
                        └─────────────────────────────────────────────┘
```

## BPA Flow (Automated Email Processing)

1. **Get Email**: BPA monitors an Outlook mailbox for new PO emails with PDF attachments
2. **Extract Data**: Document AI extracts header fields (PO number, dates, amounts) and line items (barcode, quantity, price) from the PDF
3. **Lookup ShipTo & Sales Area**: Calls `lookupShipToAndSalesArea` with the process name (e.g. "Lulu", "Carrefour") to get customer ShipTo partners and sales area mapping
4. **Create Sales Order**: Calls `processAndCreateSalesOrder` which:
   - Saves the PO log to S/4HANA (OCRLogHead + OCRLogItem)
   - Looks up materials by EAN barcode (API_PRODUCT_SRV)
   - Finds SoldToParty from ShipTo partners based on delivery address
   - Resolves company code and sales area based on Brand + Material Group
   - Creates the Sales Order via API_SALES_ORDER_SRV
   - Updates the log with SUCCESS/FAILED status and SO number

### Supported Customers (Process Names)

| Process Name | SO Type | Notes |
|-------------|---------|-------|
| Carrefour   | 1SHD*   | Ship-to delivery address fields |
| Emax        | 1SHD*   | Ship-to delivery address fields |
| Retail      | 1SHD*   | Ship-to delivery address fields |
| Lulu        | 1SHD*   | Ship-to delivery address fields |
| SharafDG    | 1SHD*   | Ship-to delivery address fields |
| Eros        | 1SHD*   | Ship-to delivery address fields |
| Sephora     | 1SSR    | Standard sales order |
| Dyson       | 1SSR    | Standard sales order |

*1SHD is used when vendor address is available; otherwise falls back to 1SSR.

## Fiori Elements UI (OCR Log Trigger)

A custom SAP Fiori Elements V4 List Report + Object Page for monitoring and managing OCR logs.

### List Report Screen

Displays all PO processing logs with:
- **Filters**: Status, Purchase Order, Sales Order Number, Process Name, Created At
- **Columns**: Status (with criticality colors), Process, PDF, PO Number, Sales Order, Created At, Currency, Gross Amount, Discount, Item Count, Net Amount, Error Message

### Object Page (Detail Screen)

Three field groups:
- **Status**: Status (with color indicator), Sales Order, Error Message
- **Order Info**: Purchase Order, Delivery Date, Document Date, Currency, Net Amount, Gross Amount
- **Log Details**: PDF Name, Mail Subject, Delivery Address, Vendor Address, Created At, Updated At

**Items Table**: Item No, Barcode, Description, Material, Qty, Unit Price, UOM, Discount

### Actions

- **Trigger**: Re-triggers Sales Order creation for failed/edited logs. Reads current log data from S/4HANA, performs fresh ShipTo/SalesArea lookup, and attempts SO creation again. Disabled when a Sales Order already exists.
- **Edit**: Opens a popup to edit header fields (Purchase Order, Net Amount, Gross Amount, Currency, Delivery Address, Vendor Address) and item fields (Barcode, Material Number, Unit Price, Discount). Saves changes to S/4HANA via PATCH. Disabled when a Sales Order already exists.

## Project Structure

```
JumboOCR/
├── srv/
│   ├── ocr-service.cds              # Service definition (entities + actions)
│   ├── ocr-service.js               # Service implementation
│   └── server.js                    # CAP server bootstrap
├── app/
│   ├── ocr-trigger/                 # Fiori Elements source
│   │   ├── annotations.cds          # UI annotations (fields, columns, facets)
│   │   └── webapp/ext/
│   │       ├── ObjectPageExt.js      # Edit popup logic
│   │       └── OPControllerExtension.controller.js  # Trigger button logic
│   └── fiori/                       # Built/deployed UI artifacts
│       ├── Component-preload.js     # Minified bundle
│       └── ext/                     # Debug versions of extensions
├── mta.yaml                         # MTA build descriptor
├── package.json                     # Dependencies and scripts
└── xs-app.json                      # App Router configuration
```

## OData Service (ocr-srv)

**Endpoint**: `/odata/v4/ocr`

### Actions (called by BPA)

| Action | Description |
|--------|-------------|
| `lookupShipToAndSalesArea(ocrCompany)` | Returns ShipTo partners and Sales Area mapping for a customer |
| `processAndCreateSalesOrder(extractedData, shipToAndSalesArea, processName, pdfName, mailSubject)` | Full flow: save log, lookup materials, create SO, update log |

### Actions (called by UI)

| Action | Description |
|--------|-------------|
| `triggerLog(uuid)` | Re-trigger SO creation for an existing log |
| `updatePOLogData(uuid, headerData, itemsData)` | Update log header and item fields |

### Entities (proxied to S/4HANA)

Both entities use `@cds.persistence.skip: true` - no local database. All reads/writes are proxied to S/4HANA custom OData service (ZSDOCR).

| Entity | Description |
|--------|-------------|
| `OCRLogs` | PO processing log headers (status, amounts, dates, addresses) |
| `OCRItems` | Line items per log (barcode, material, quantity, price) |

## Sales Area Resolution

The system resolves the correct Sales Organization based on a priority matching algorithm:

1. **BUKRS + MATKL_FAM + Brand** (best match - company code, material group family, and product brand)
2. **BUKRS + Brand** (company code + brand, ignoring material group)
3. **BUKRS + MATKL_FAM** (company code + material group, ignoring brand)
4. **Brand only** (cross-company fallback)
5. **BUKRS only** (last resort)

The Brand is fetched from `API_PRODUCT_SRV` alongside material lookup. Material Group Family (MATKL_FAM) is the first 3 characters of the ProductGroup.

## BTP Destinations

| Destination | Type | Usage |
|-------------|------|-------|
| `QS4_HTTPS` | On-Premise (Cloud Connector) | S/4HANA API calls (SO creation, product lookup, log CRUD) |

## Build and Deploy

```bash
# Install dependencies
npm install

# Build MTA archive
mbt build

# Deploy to Cloud Foundry
cf login -a https://api.cf.eu10-004.hana.ondemand.com
cf deploy mta_archives/archive.mtar --retries 1

# Check logs
cf logs ocr-srv --recent
cf logs jumbo-ocr-approuter --recent
```

### Build Process

1. `npm ci` - Install dependencies
2. `npx cds build --production` - Build CDS artifacts
3. `npm --prefix app/ocr-trigger install && run build:cf` - Build Fiori app
4. Copy `app/ocr-trigger/dist/` to `app/fiori/` - Stage for deployment
5. `mbt build` - Package MTA archive
6. `cf deploy` - Deploy to BTP

## Troubleshooting

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `SoldToParty not found` | ShipTo partner not found for delivery address | Check ZSDOCR ShipTo mapping in S/4HANA |
| `Article X is not defined for sales org Y` | Wrong Sales Area selected for the product brand | Check Brand mapping in ZSDOCR SalesAreaMap |
| `Material not found (EAN: X)` | Barcode not in A_Product master data | Add product with EAN in S/4HANA |
| `Property 'X' is invalid` | PATCH body contains non-existent S/4HANA field | Check OCRLogHead entity fields in S/4HANA |

### Check Logs

```bash
# CAP service logs
cf logs ocr-srv --recent

# App Router logs  
cf logs jumbo-ocr-approuter --recent
```

## Tech Stack

- **SAP CAP** (Node.js) - OData V4 service framework
- **SAP Fiori Elements V4** - List Report + Object Page
- **SAP Build Process Automation** - Email monitoring and Document AI
- **SAP Cloud SDK** - HTTP client for S/4HANA connectivity
- **S/4HANA** - Sales Order, Business Partner, Product APIs + custom ZSDOCR OData

---

**Version**: 1.0.0
**Last Updated**: March 2026
