@path: '/odata/v4/ocr'
service OCRService {

  action createSalesOrder(payload : String) returns {
    salesOrderNumber: String;
    message: String;
    success: Boolean;
  };

  action lookupProducts(identifiers : String, lookupType : String) returns {
    products: String;
    success: Boolean;
    message: String;
  };

  action lookupShipToPartner(ocrCompany : String) returns {
    shipToId: String;
    shipToAddress: String;
    success: Boolean;
    message: String;
  };
}
