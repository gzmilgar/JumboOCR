# Jumbo OCR to Sales Order Automation

CAP proxy service for creating S/4HANA Sales Orders from Document AI extracted Purchase Orders.

## Architecture
```
Email (PDF) → Document AI → SAP Build → CAP Service → S/4HANA
                                           ↓
                                   handheldterminal_cap destination
```

## Features

- ✅ Parse Document AI extraction data
- ✅ Map PO fields to S/4HANA Sales Order format
- ✅ Create Sales Orders via existing destination
- ✅ No local database (stateless proxy)
- ✅ Validation before S/4HANA call
- ✅ Error handling and logging

## Prerequisites

- BTP Destination: `handheldterminal_cap` (already configured)
- S/4HANA API: `API_SALES_ORDER_SRV`
- Cloud Foundry access

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Update Mappings

Edit `srv/ocr-service.js`:

**Customer Mapping (line ~300):**
```javascript
const customerMapping = {
  "070073": "0001000015",  // Your actual store → customer mappings
  "070074": "0001000016"
};
```

**Material Mapping (line ~320):**
```javascript
// Update if material codes need transformation
```

### 3. Deploy
```bash
cf login
cf push jumbo-ocr-srv
```

## API Endpoints

### Create Sales Order
```http
POST /odata/v4/ocr/createSalesOrderFromExtraction
Content-Type: application/json

{
  "extractionData": "{\"extraction\":{\"headerFields\":[...],\"lineItems\":[...]}}"
}
```

### Validate Extraction
```http
POST /odata/v4/ocr/validateExtraction
Content-Type: application/json

{
  "extractionData": "{\"extraction\":{...}}"
}
```

### Health Check
```http
GET /health
GET /ping
```

## Configuration

Environment variables in `manifest.yml`:

- `S4HANA_SALES_ORG`: Sales Organization (default: 1710)
- `S4HANA_DIST_CHANNEL`: Distribution Channel (default: 10)
- `S4HANA_DIVISION`: Division (default: 00)
- `S4HANA_SO_TYPE`: Sales Order Type (default: OR)

## Destination

Uses existing destination: `handheldterminal_cap`

Properties:
- WebIDEEnabled = true
- WebIDEUsage = odata_gen
- HTML5.DynamicDestination = true
- HTML5.Timeout = 60000
- sap.applicationdevelopment.actions.enabled = true
- sap.build.usage = CAP

## TODO

- [ ] Implement real customer mapping logic
- [ ] Implement real material mapping logic
- [ ] Add retry logic for transient failures
- [ ] Add monitoring/alerting
- [ ] Add unit tests

## Troubleshooting

Check logs:
```bash
cf logs jumbo-ocr-srv --recent
```

Test health:
```bash
curl https://jumbo-ocr-srv.cfapps.eu10-004.hana.ondemand.com/health
```