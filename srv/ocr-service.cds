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

  action lookupShipToAndSalesArea(ocrCompany : String) returns {
    shipToId: String;
    shipToAddress: String;
    salesOrganization: String;
    distributionChannel: String;
    organizationDivision: String;
    success: Boolean;
    message: String;
  };

  action lookupBusinessPartner(taxNumber : String) returns {
    businessPartner: String;
    success: Boolean;
    message: String;
  };
}
