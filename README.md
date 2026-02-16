# Jumbo OCR to Sales Order Automation

CAP proxy service that creates S/4HANA Sales Orders from Document AI extracted Purchase Orders.

## 📋 Architecture
```
Email (PDF) → Document AI → SAP Build Process Automation → CAP Service → S/4HANA
                                                               ↓
                                                    handheldterminal_cap
```

## 🎯 Features

- ✅ Parse Document AI extraction data (headerFields + lineItems)
- ✅ Map PO fields to S/4HANA Sales Order format
- ✅ Create Sales Orders via BTP destination (handheldterminal_cap)
- ✅ No local database (stateless proxy)
- ✅ No customer/material mapping (direct from PDF)
- ✅ Validation before S/4HANA call
- ✅ Comprehensive error handling and logging

## 🔧 Prerequisites

- **BTP Destination**: `handheldterminal_cap` (already configured)
- **S/4HANA API**: `API_SALES_ORDER_SRV`
- **Cloud Foundry**: CLI and access
- **Node.js**: v18 or v20

## 🚀 Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Verify BTP Destination

Ensure `handheldterminal_cap` destination exists in BTP Cockpit:
- Name: `handheldterminal_cap`
- Type: HTTP
- Proxy Type: OnPremise
- Authentication: BasicAuthentication

### 3. Deploy to Cloud Foundry
```bash
cf login -a https://api.cf.eu10-004.hana.ondemand.com
cf target -o "Jumbo Electronics Company Limited LLC_jumbo-dev-rhvtsopa" -s Jumbo_Dev_Space
cf push jumbo-ocr-srv
```

## 📡 API Endpoints

### Create Sales Order from Extraction
```http
POST /odata/v4/ocr/createSalesOrderFromExtraction
Content-Type: application/json

{
  "extractionData": "{\"extraction\":{\"headerFields\":[...],\"lineItems\":[...]}}"
}
```

**Response:**
```json
{
  "salesOrderNumber": "0000012345",
  "message": "Sales Order 0000012345 created successfully from PO 007-26008851",
  "success": true
}
```

### Validate Extraction Data
```http
POST /odata/v4/ocr/validateExtraction
Content-Type: application/json

{
  "extractionData": "{\"extraction\":{...}}"
}
```

**Response:**
```json
{
  "valid": true,
  "errors": []
}
```

### Health Check
```http
GET /health
GET /ping
```

## 🔄 Data Flow
```
Document AI Extraction
{
  "extraction": {
    "headerFields": [
      {"name": "purchaseOrder", "value": "007-26008851"},
      {"name": "receiverId", "value": "1100019"},
      {"name": "documentDate", "value": "2026-02-05"},
      {"name": "currencyCode", "value": "AED"}
    ],
    "lineItems": [[
      {"name": "customerMaterialNumber", "value": "470521-01"},
      {"name": "quantity", "value": 2},
      {"name": "unitPrice", "value": 1765.35}
    ]]
  }
}
        ↓
CAP Service Mapping
        ↓
S/4HANA Sales Order
{
  "SalesOrderType": "1SDS",
  "SoldToParty": "1100019",
  "PurchaseOrderByCustomer": "007-26008851",
  "to_Partner": [...],
  "to_Item": [{
    "MaterialByCustomer": "470521-01",
    "RequestedQuantity": "2"
  }]
}
```

## ⚙️ Configuration

Environment variables (in `manifest.yml`):

| Variable | Default | Description |
|----------|---------|-------------|
| S4HANA_SALES_ORG | D106 | Sales Organization |
| S4HANA_DIST_CHANNEL | 02 | Distribution Channel |
| S4HANA_DIVISION | 00 | Division |
| S4HANA_SO_TYPE | 1SDS | Sales Order Type |
| S4HANA_PAYMENT_TERMS | Z000 | Payment Terms |
| S4HANA_PLANT | DODY | Production Plant |

## 📊 Document AI Schema Mapping

### Header Fields

| Document AI Field | S/4HANA Field |
|-------------------|---------------|
| purchaseOrder | PurchaseOrderByCustomer |
| receiverId | SoldToParty |
| documentDate | CustomerPurchaseOrderDate |
| deliveryAdress | to_Partner.to_Address |
| currencyCode | TransactionCurrency |

### Line Item Fields

| Document AI Field | S/4HANA Field |
|-------------------|---------------|
| customerMaterialNumber | MaterialByCustomer |
| quantity | RequestedQuantity |
| unitPrice | to_PricingElement[ZMAN] |
| DiscValue | to_PricingElement[ZRDV] |
| VATValue | to_PricingElement[ZVAT] |

## 🐛 Troubleshooting

### Check Logs
```bash
cf logs jumbo-ocr-srv --recent
```

### Test Health
```bash
curl https://jumbo-ocr-srv.cfapps.eu10-004.hana.ondemand.com/health
```

### Common Issues

1. **Token Expired**: Re-login with `cf login`
2. **Destination Not Found**: Check `handheldterminal_cap` exists in BTP
3. **S/4HANA Error**: Check logs for detailed error message
4. **Validation Failed**: Ensure all required fields are in extraction data

## 📝 Notes

- **No Database**: Service is stateless, no data persistence
- **No Mapping**: Customer and material numbers used directly from PDF
- **Validation**: Data validated before S/4HANA call
- **Error Handling**: Comprehensive error messages for debugging

## 🔗 Related Components

- **Document AI**: Jumbo_OCR_purchaseOrder_schema_with_numbers
- **SAP Build**: CarrefourOCRAutomation workflow
- **Outlook**: JumboOCRDemoCarrefour folder
- **Destination**: handheldterminal_cap (OnPremise → S/4HANA)

## 📞 Support

For issues or questions, check:
1. Cloud Foundry logs: `cf logs jumbo-ocr-srv --recent`
2. BTP destination configuration
3. S/4HANA API connectivity

---

**Version**: 1.0.0  
**Last Updated**: February 2026
```

---

## 🗂️ PROJE YAPISI
```
JumboOCR/
├── srv/
│   ├── ocr-service.cds          ✅
│   ├── ocr-service.js           ✅
│   └── server.js                ✅
├── package.json                  ✅
├── manifest.yml                  ✅
├── .gitignore                    ✅
└── README.md                     ✅