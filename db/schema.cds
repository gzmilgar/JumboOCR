namespace jumbo.ocr;

using { cuid, managed } from '@sap/cds/common';

entity PurchaseOrders : cuid, managed {
  documentNumber      : String(50);
  documentDate        : Date;
  deliveryDate        : Date;
  senderName          : String(200);
  senderId            : String(50);
  receiverId          : String(50);
  shipToAddress       : String(500);
  netAmount           : Decimal(15,2);
  grossAmount         : Decimal(15,2);
  currencyCode        : String(3);
  taxIdNumber         : String(50);
  extractionConfidence: Decimal(5,4);
  processingStatus    : String(20) default 'PENDING';
  
  // Relationship
  lineItems           : Composition of many LineItems on lineItems.purchaseOrder = $self;
}

entity LineItems : cuid {
  purchaseOrder       : Association to PurchaseOrders;
  itemNumber          : String(10);
  description         : String(500);
  materialNumber      : String(50);
  supplierMaterialNumber : String(50); // Barcode/EAN
  customerMaterialNumber : String(50); // Customer article reference
  quantity            : Decimal(15,3);
  unitPrice           : Decimal(15,2);
  netAmount           : Decimal(15,2);
}
