using jumbo.ocr from '../db/schema';

service OCRService {
  entity PurchaseOrders as projection on ocr.PurchaseOrders;
  entity LineItems as projection on ocr.LineItems;
  
  // Custom action for Document AI integration
  action createPOFromExtraction(extractionData : String) returns PurchaseOrders;
}
