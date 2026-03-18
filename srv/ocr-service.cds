@path: '/odata/v4/ocr'
service OCRService {

    action lookupShipToAndSalesArea(ocrCompany : String) returns {
        shipToPartners : String;
        salesAreaMap   : String;
        success        : Boolean;
        message        : String;
    };

    action processAndCreateSalesOrder(
        extractedData      : String,
        shipToAndSalesArea : String,
        processName        : String,
        pdfName            : String,
        mailSubject        : String
    ) returns {
        salesOrderNumber : String;
        message          : String;
        success          : Boolean;
        itemCount        : Integer;
        missingBarcodes  : String;
    };

    action retryPOLog(uuid : String) returns {
        salesOrderNumber : String;
        message          : String;
        success          : Boolean;
        itemCount        : Integer;
        missingBarcodes  : String;
    };

    action getPOLogs(statusFilter : String) returns array of {
        uuid             : String;
        processName      : String;
        purchaseOrder    : String;
        deliveryDate     : String;
        status           : String;
        salesOrderNumber : String;
        errorMessage     : String;
        itemCount        : Integer;
        createdAt        : String;
        updatedAt        : String;
    };

    action getPOLog(uuid : String) returns {
        uuid             : String;
        processName      : String;
        pdfName          : String;
        purchaseOrder    : String;
        deliveryDate     : String;
        documentDate     : String;
        receiverId       : String;
        currencyCode     : String;
        netAmount        : String;
        grossAmount      : String;
        totalVat         : String;
        discount         : String;
        deliveryAdress   : String;
        vendorAdress     : String;
        paymentTerms     : String;
        taxId            : String;
        vendorNo         : String;
        status           : String;
        salesOrderNumber : String;
        errorMessage     : String;
        itemCount        : Integer;
        missingBarcodes  : String;
        createdAt        : String;
        items            : String;
    };

    action updatePOLogData(
        uuid       : String,
        headerData : String,
        itemsData  : String
    ) returns {
        success : Boolean;
        message : String;
    };
}