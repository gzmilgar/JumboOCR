using OCRService as service from '../../srv/ocr-service';

// ============================================================
// List Report - Tablo kolonları
// ============================================================
annotate service.OCRLogs with @(
    UI.LineItem: [
        { $Type: 'UI.DataField', Value: ProcessName,      Label: 'Process'      },
        { $Type: 'UI.DataField', Value: PdfName,          Label: 'PDF'          },
        { $Type: 'UI.DataField', Value: PurchaseOrder,    Label: 'PO Number'    },
        { $Type: 'UI.DataField', Value: Status,           Label: 'Status'       },
        { $Type: 'UI.DataField', Value: SalesOrderNumber, Label: 'Sales Order'  },
        { $Type: 'UI.DataField', Value: CreatedAt,        Label: 'Created At'   },
        {
            $Type  : 'UI.DataFieldForAction',
            Label  : 'Trigger',
            Action : 'OCRService.triggerLog',
            Inline : true,
        },
    ],
);

// ============================================================
// Object Page - Alan grupları
// ============================================================
annotate service.OCRLogs with @(
    UI.FieldGroup #Status : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type: 'UI.DataField', Value: Status,           Label: 'Status'        },
            { $Type: 'UI.DataField', Value: SalesOrderNumber, Label: 'Sales Order'   },
            { $Type: 'UI.DataField', Value: ErrorMessage,     Label: 'Error Message' },
            { $Type: 'UI.DataField', Value: MissingBarcodes,  Label: 'Missing Barcodes' },
        ]
    },
    UI.FieldGroup #OrderInfo : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type: 'UI.DataField', Value: PurchaseOrder,  Label: 'Purchase Order'  },
            { $Type: 'UI.DataField', Value: DeliveryDate,   Label: 'Delivery Date'   },
            { $Type: 'UI.DataField', Value: DocumentDate,   Label: 'Document Date'   },
            { $Type: 'UI.DataField', Value: ReceiverId,     Label: 'Receiver ID'     },
            { $Type: 'UI.DataField', Value: CurrencyCode,   Label: 'Currency'        },
            { $Type: 'UI.DataField', Value: NetAmount,      Label: 'Net Amount'      },
            { $Type: 'UI.DataField', Value: GrossAmount,    Label: 'Gross Amount'    },
        ]
    },
    UI.FieldGroup #LogInfo : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type: 'UI.DataField', Value: PdfName,        Label: 'PDF Name'        },
            { $Type: 'UI.DataField', Value: MailSubject,    Label: 'Mail Subject'    },
            { $Type: 'UI.DataField', Value: DeliveryAdress, Label: 'Delivery Addr'   },
            { $Type: 'UI.DataField', Value: VendorAdress,   Label: 'Vendor Addr'     },
            { $Type: 'UI.DataField', Value: CreatedAt,      Label: 'Created At'      },
            { $Type: 'UI.DataField', Value: UpdatedAt,      Label: 'Updated At'      },
        ]
    },

    UI.Facets: [
        {
            $Type  : 'UI.CollectionFacet',
            Label  : 'Genel Bilgiler',
            Facets : [
                {
                    $Type  : 'UI.ReferenceFacet',
                    Label  : 'Durum',
                    Target : '@UI.FieldGroup#Status',
                },
                {
                    $Type  : 'UI.ReferenceFacet',
                    Label  : 'Sipariş Bilgileri',
                    Target : '@UI.FieldGroup#OrderInfo',
                },
                {
                    $Type  : 'UI.ReferenceFacet',
                    Label  : 'Log Detayı',
                    Target : '@UI.FieldGroup#LogInfo',
                },
            ],
        },
        {
            $Type  : 'UI.ReferenceFacet',
            Label  : 'Kalemler',
            Target : 'Items/@UI.LineItem',
        },
    ],

    UI.Identification: [
        {
            $Type  : 'UI.DataFieldForAction',
            Label  : 'Trigger',
            Action : 'OCRService.triggerLog',
        },
    ],
);

// ============================================================
// OCRItems - Kalem tablosu kolonları
// ============================================================
annotate service.OCRItems with @(
    UI.LineItem: [
        { $Type: 'UI.DataField', Value: ItemNumber,     Label: 'Item No'     },
        { $Type: 'UI.DataField', Value: Barcode,        Label: 'Barcode'     },
        { $Type: 'UI.DataField', Value: Description,    Label: 'Description' },
        { $Type: 'UI.DataField', Value: MaterialNumber, Label: 'Material'    },
        { $Type: 'UI.DataField', Value: Quantity,       Label: 'Qty'         },
        { $Type: 'UI.DataField', Value: UnitPrice,      Label: 'Unit Price'  },
        { $Type: 'UI.DataField', Value: Unit,           Label: 'UOM'         },
        { $Type: 'UI.DataField', Value: Discount,       Label: 'Discount'    },
    ],
);
