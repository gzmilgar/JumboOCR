@path: '/odata/v4/ocr'
service OCRService {

  action lookupShipToPartner(ocrCompany : String) returns {
    shipToId: String;
    shipToAddress: String;
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
