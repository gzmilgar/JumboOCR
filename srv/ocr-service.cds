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


    action extractAndProcess(
        pdfBase64   : String,
        processName : String,
        pdfName     : String,
        mailSubject : String
    ) returns {
        salesOrderNumber : String;
        message          : String;
        success          : Boolean;
        itemCount        : Integer;
        missingBarcodes  : String;
    };

    action triggerLog(uuid : String) returns {
        success    : Boolean;
        message    : String;
        salesOrder : String;
    };


    // ==========================================
    // Entities
    // ==========================================
    @cds.persistence.skip: true
    entity OCRLogs {
        key Uuid             : String(36);
            ProcessName      : String;
            PdfName          : String;
            MailSubject      : String;
            PurchaseOrder    : String;
            DeliveryDate     : String;
            DocumentDate     : String;
            ReceiverId       : String;
            CurrencyCode     : String;
            NetAmount        : Decimal;
            GrossAmount      : Decimal;
            TotalVat         : String;
            Discount         : Decimal;
            DeliveryAdress   : String;
            VendorAdress     : String;
            PaymentTerms     : String;
            TaxId            : String;
            VendorNo         : String;
            Status           : String;
            StatusCriticality : Integer;
            SalesOrderNumber : String;
            ErrorMessage     : String;
            MissingBarcodes  : String;
            ItemCount        : Integer;
            CreatedAt        : String;
            UpdatedAt        : String;
        Items : Composition of many OCRItems
                on Items.HeaderId = $self.Uuid;
    }

    @cds.persistence.skip: true
    entity OCRItems {
        key HeaderId         : String(36);
        key ItemNumber       : String(6);
            Barcode          : String;
            Description      : String;
            MaterialNumber   : String;
            Unit             : String;
            Quantity         : Decimal;
            UnitPrice        : Decimal;
            Discount         : Decimal;
    }
}