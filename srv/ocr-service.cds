@path: '/odata/v4/ocr'
service OCRService {

  action lookupShipToAndSalesArea(ocrCompany : String) returns {
    shipToPartners: String;
    salesAreaMap: String;
    success: Boolean;
    message: String;
  };

  action processAndCreateSalesOrder(
    extractedData      : String,
    shipToAndSalesArea : String,
    processName        : String
  ) returns {
    salesOrderNumber: String;
    message: String;
    success: Boolean;
    itemCount: Integer;
    missingBarcodes: String;
  };
}