using OCRService as service from '../../srv/ocr-service';

// ============================================================
// Capabilities - OCRLogs
// ============================================================
annotate service.OCRLogs with @(
    UI.UpdateHidden : false,
    UI.DeleteHidden : true,
    UI.CreateHidden : true,
    Capabilities.UpdateRestrictions: {


        $Type     : 'Capabilities.UpdateRestrictionsType',
        Updatable : true
    },
    Capabilities.DeleteRestrictions: {
        $Type     : 'Capabilities.DeleteRestrictionsType',
        Deletable : false
    },
    Capabilities.InsertRestrictions: {


        $Type      : 'Capabilities.InsertRestrictionsType',
        Insertable : false
    }
);

// ============================================================
// Capabilities - OCRItems
// ============================================================
annotate service.OCRItems with @(
    UI.UpdateHidden : false,
    UI.DeleteHidden : true,
    UI.CreateHidden : true,
    Capabilities.UpdateRestrictions: {
        $Type     : 'Capabilities.UpdateRestrictionsType',
        Updatable : true
    },
    Capabilities.DeleteRestrictions: {


        $Type     : 'Capabilities.DeleteRestrictionsType',
        Deletable : false
    },
    Capabilities.InsertRestrictions: {
        $Type      : 'Capabilities.InsertRestrictionsType',
        Insertable : false
    }
);

// ============================================================
// Field Level Annotations - OCRLogs
// Read-only vs Editable alanlar
// ============================================================
annotate service.OCRLogs with {
    // Read-only alanlar
    Uuid             @Core.Immutable: true
                     @UI.HiddenFilter: true;
    ProcessName      @Core.Computed: true;
    PdfName          @Core.Computed: true;
    MailSubject      @Core.Computed: true;
    Status           @Core.Computed: true;
    StatusCriticality @Core.Computed: true
                     @UI.HiddenFilter: true;
    SalesOrderNumber @Core.Computed: true;
    ErrorMessage     @Core.Computed: true;
    MissingBarcodes  @Core.Computed: true;
    ItemCount        @Core.Computed: true;
    CreatedAt        @Core.Computed: true;
    UpdatedAt        @Core.Computed: true;
    NetAmount        @title: 'Net Amount';
    GrossAmount      @title: 'Gross Amount';
    TotalVat         @Core.Computed: true;

    // Edit edilebilir alanlar
    PurchaseOrder    @title: 'Purchase Order';
    DeliveryDate     @title: 'Delivery Date';
    DocumentDate     @title: 'Document Date';
    ReceiverId       @title: 'Receiver ID';
    CurrencyCode     @title: 'Currency';
    DeliveryAdress   @title: 'Delivery Address';
    VendorAdress     @title: 'Vendor Address';
    Discount         @title: 'Discount';
}

// ============================================================
// Field Level Annotations - OCRItems
// Read-only vs Editable alanlar
// ============================================================
annotate service.OCRItems with {
    // Read-only alanlar
    HeaderId       @Core.Immutable: true
                   @UI.HiddenFilter: true;
    ItemNumber     @Core.Computed: true;
    Description    @Core.Computed: true;
    MaterialNumber @Core.Computed: true;
    Unit           @Core.Computed: true;

    // Edit edilebilir alanlar
    Barcode        @title: 'Barcode';
    Quantity       @title: 'Quantity';
    UnitPrice      @title: 'Unit Price';
    Discount       @title: 'Discount';
}

// ============================================================
// List Report - Selection Filters
// ============================================================
annotate service.OCRLogs with @(
    UI.SelectionFields: [
        PurchaseOrder,
        SalesOrderNumber,
        ProcessName,
        DocumentDate
    ]
);

// ============================================================
// List Report - Table Columns
// ============================================================
annotate service.OCRLogs with @(
    UI.DataPoint #StatusDP : {
        Value       : Status,
        Criticality : StatusCriticality,
        Title       : 'Status'
    },

    UI.LineItem: [
        {


            $Type : 'UI.DataField',
            Value : ProcessName,
            Label : 'Process'
        },
        {
            $Type : 'UI.DataField',
            Value : PdfName,
            Label : 'PDF'
        },
        {


            $Type : 'UI.DataField',
            Value : PurchaseOrder,
            Label : 'PO Number'
        },
        {
            $Type  : 'UI.DataFieldForAnnotation',
            Target : '@UI.DataPoint#StatusDP',
            Label  : 'Status'
        },
        {
            $Type : 'UI.DataField',
            Value : SalesOrderNumber,
            Label : 'Sales Order'
        },
        {
            $Type : 'UI.DataField',
            Value : CreatedAt,
            Label : 'Created At'
        }
    ]
);

// ============================================================
// Object Page - Header Info
// ============================================================
annotate service.OCRLogs with @(
    UI.HeaderInfo: {
        $Type          : 'UI.HeaderInfoType',
        TypeName       : 'OCR Log',
        TypeNamePlural : 'OCR Logs',
        Title          : { Value: PurchaseOrder },
        Description    : { Value: ProcessName }
    }
);

// ============================================================
// Object Page - Field Groups
// ============================================================
annotate service.OCRLogs with @(

    UI.FieldGroup #Status: {
        $Type : 'UI.FieldGroupType',
        Label : 'Status',
        Data  : [
            {
                $Type  : 'UI.DataFieldForAnnotation',
                Target : '@UI.DataPoint#StatusDP',
                Label  : 'Status'
            },
            {


                $Type : 'UI.DataField',
                Value : SalesOrderNumber,
                Label : 'Sales Order'
            },
            {
                $Type : 'UI.DataField',
                Value : ErrorMessage,
                Label : 'Error Message'
            },
            {


                $Type : 'UI.DataField',
                Value : MissingBarcodes,
                Label : 'Missing Barcodes'
            }
        ]
    },

    UI.FieldGroup #OrderInfo: {
        $Type : 'UI.FieldGroupType',
        Label : 'Order Info',
        Data  : [
            {


                $Type : 'UI.DataField',
                Value : PurchaseOrder,
                Label : 'Purchase Order'
            },
            {
                $Type : 'UI.DataField',
                Value : DeliveryDate,
                Label : 'Delivery Date'
            },
            {


                $Type : 'UI.DataField',
                Value : DocumentDate,
                Label : 'Document Date'
            },
            {
                $Type : 'UI.DataField',
                Value : ReceiverId,
                Label : 'Receiver ID'
            },
            {


                $Type : 'UI.DataField',
                Value : CurrencyCode,
                Label : 'Currency'
            },
            {
                $Type : 'UI.DataField',
                Value : NetAmount,
                Label : 'Net Amount'
            },
            {


                $Type : 'UI.DataField',
                Value : GrossAmount,
                Label : 'Gross Amount'
            }
        ]
    },

   UI.FieldGroup #LogInfo: {


        $Type : 'UI.FieldGroupType',
        Label : 'Log Details',
        Data  : [
            {
                $Type : 'UI.DataField',
                Value : PdfName,
                Label : 'PDF Name'
            },
            {


                $Type : 'UI.DataField',
                Value : MailSubject,
                Label : 'Mail Subject'
            },
            {
                $Type : 'UI.DataField',
                Value : DeliveryAdress,
                Label : 'Delivery Address'
            },
            {


                $Type : 'UI.DataField',
                Value : VendorAdress,
                Label : 'Vendor Address'
            },
            {
                $Type : 'UI.DataField',
                Value : CreatedAt,
                Label : 'Created At'
            },
            {


                $Type : 'UI.DataField',
                Value : UpdatedAt,
                Label : 'Updated At'
            }
        ]
    },

    // ============================================================
    // Object Page - Facets
    // ============================================================
    UI.Facets: [
        {
            $Type  : 'UI.CollectionFacet',
            ID     : 'GeneralInfo',
            Label  : 'General Information',
            Facets : [
                {


                    $Type  : 'UI.ReferenceFacet',
                    ID     : 'StatusFacet',
                    Label  : 'Status',
                    Target : '@UI.FieldGroup#Status'
                },
                {
                    $Type  : 'UI.ReferenceFacet',
                    ID     : 'OrderInfoFacet',
                    Label  : 'Order Info',
                    Target : '@UI.FieldGroup#OrderInfo'
                },
                {


                    $Type  : 'UI.ReferenceFacet',
                    ID     : 'LogInfoFacet',
                    Label  : 'Log Details',
                    Target : '@UI.FieldGroup#LogInfo'
                }
            ]
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'ItemsFacet',
            Label  : 'Items',
            Target : 'Items/@UI.LineItem'
        }
    ],

    // ============================================================
    // Object Page - Identification (Header Action Buttons)
    // ============================================================
    UI.Identification: []
);

// ============================================================
// OCRItems - Items Table Columns
// ============================================================
annotate service.OCRItems with @(
    UI.LineItem: [
        {
            $Type : 'UI.DataField',
            Value : ItemNumber,
            Label : 'Item No'
        },
        {


            $Type : 'UI.DataField',
            Value : Barcode,
            Label : 'Barcode'
        },
        {
            $Type : 'UI.DataField',
            Value : Description,
            Label : 'Description'
        },
        {


            $Type : 'UI.DataField',
            Value : MaterialNumber,
            Label : 'Material'
        },
        {
            $Type : 'UI.DataField',
            Value : Quantity,
            Label : 'Qty'
        },
        {


            $Type : 'UI.DataField',
            Value : UnitPrice,
            Label : 'Unit Price'
        },
        {
            $Type : 'UI.DataField',
            Value : Unit,
            Label : 'UOM'
        },
        {
            $Type : 'UI.DataField',
            Value : Discount,
            Label : 'Discount'
        }
    ]
);