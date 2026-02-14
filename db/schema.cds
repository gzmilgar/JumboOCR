namespace jumbo.ocr;

entity PurchaseOrders {
  key ID : UUID;
  
  // Header Fields
  documentNumber : String(50);
  documentDate : Date;
  deliveryDate : Date;
  senderName : String(255);
  senderId : String(50);
  receiverId : String(50);
  shipToAddress : String(500);
  netAmount : Decimal(15,2);
  grossAmount : Decimal(15,2);
  currencyCode : String(3);
  taxIdNumber : String(50);
  
  // Metadata
  extractionConfidence : Decimal(3,2);
  processingStatus : String(20);
  createdAt : Timestamp;
  
  // Association
  lineItems : Composition of many LineItems on lineItems.purchaseOrder = $self;
}

entity LineItems {
  key ID : UUID;
  
  purchaseOrder : Association to PurchaseOrders;
  
  // Line Item Fields
  itemNumber : String(10);
  description : String(500);
  materialNumber : String(50);
  supplierMaterialNumber : String(50); // Barcode
  customerMaterialNumber : String(50); // Article Reference
  quantity : Decimal(15,3);
  unitPrice : Decimal(15,2);
  netAmount : Decimal(15,2);
}