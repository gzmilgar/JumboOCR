@path: '/odata/v4/ocr'
service OCRService {

  // Generic: Create Sales Order from JSON payload (Excel, PDF, etc.)
  action createSalesOrder(payload : String) returns {
    salesOrderNumber: String;
    message: String;
    success: Boolean;
  };
}
