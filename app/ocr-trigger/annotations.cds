using OCRService as service from '../../srv/ocr-service';
annotate service.OCRLogs with @(
    UI.FieldGroup #GeneratedGroup : {
        $Type : 'UI.FieldGroupType',
        Data : [
            {
                $Type : 'UI.DataField',
                Label : 'Uuid',
                Value : Uuid,
            },
            {
                $Type : 'UI.DataField',
                Label : 'ProcessName',
                Value : ProcessName,
            },
            {
                $Type : 'UI.DataField',
                Label : 'PdfName',
                Value : PdfName,
            },
            {
                $Type : 'UI.DataField',
                Label : 'Status',
                Value : Status,
            },
            {
                $Type : 'UI.DataField',
                Label : 'PurchaseOrder',
                Value : PurchaseOrder,
            },
            {
                $Type : 'UI.DataField',
                Label : 'SalesOrderNumber',
                Value : SalesOrderNumber,
            },
            {
                $Type : 'UI.DataField',
                Label : 'ErrorMessage',
                Value : ErrorMessage,
            },
            {
                $Type : 'UI.DataField',
                Label : 'CreatedAt',
                Value : CreatedAt,
            },
        ],
    },
    UI.Facets : [
        {
            $Type : 'UI.ReferenceFacet',
            ID : 'GeneratedFacet1',
            Label : 'General Information',
            Target : '@UI.FieldGroup#GeneratedGroup',
        },
    ],
    UI.LineItem : [
        {
            $Type : 'UI.DataField',
            Label : 'Uuid',
            Value : Uuid,
        },
        {
            $Type : 'UI.DataField',
            Label : 'ProcessName',
            Value : ProcessName,
        },
        {
            $Type : 'UI.DataField',
            Label : 'PdfName',
            Value : PdfName,
        },
        {
            $Type : 'UI.DataField',
            Label : 'Status',
            Value : Status,
        },
        {
            $Type : 'UI.DataField',
            Label : 'PurchaseOrder',
            Value : PurchaseOrder,
        },
    ],
);

