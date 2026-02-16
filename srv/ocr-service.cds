@path: '/odata/v4/ocr'
service OCRService {
  
  // Main action: Create Sales Order from Document AI extraction
  action createSalesOrderFromExtraction(extractionData : String) returns {
    salesOrderNumber: String;
    message: String;
    success: Boolean;
  };
  
  // Optional: Validate extraction data before processing
  action validateExtraction(extractionData : String) returns {
    valid: Boolean;
    errors: array of String;
  };
}