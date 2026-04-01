sap.ui.define([
    "sap/m/MessageToast",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Input",
    "sap/m/Label",
    "sap/m/TextArea",
    "sap/m/Table",
    "sap/m/Column",
    "sap/m/ColumnListItem",
    "sap/m/Text",
    "sap/ui/layout/form/SimpleForm",
    "sap/ui/model/json/JSONModel"
], function (MessageToast, Dialog, Button, Input, Label, TextArea, Table, Column, ColumnListItem, Text, SimpleForm, JSONModel) {
    "use strict";

    return {
        onEditPress: function (oEvent) {
            var oSource = oEvent.getSource();
            var oBindingContext = oSource.getBindingContext();

            if (!oBindingContext) {
                MessageToast.show("No data context available");
                return;
            }

            var oModel = oBindingContext.getModel();

            oBindingContext.requestObject().then(function (oData) {
                if (oData.SalesOrderNumber) {
                    sap.m.MessageBox.warning(
                        "Sales Order " + oData.SalesOrderNumber + " already created. Editing is not allowed.",
                        { title: "Edit Not Allowed" }
                    );
                    return;
                }

                var oListBinding = oModel.bindList(oBindingContext.getPath() + "/Items");
                oListBinding.requestContexts(0, 9999).then(function (aItemContexts) {
                    var aItems = aItemContexts.map(function (ctx) {
                        var obj = ctx.getObject();
                        return {
                            itemNumber: obj.ItemNumber || "",
                            barcode: obj.Barcode || "",
                            description: obj.Description || "",
                            materialNumber: obj.MaterialNumber || "",
                            quantity: obj.Quantity != null ? String(obj.Quantity) : "0",
                            unit: obj.Unit || "EA",
                            unitPrice: obj.UnitPrice != null ? String(obj.UnitPrice) : "0"
                        };
                    });

                    var oEditModel = new JSONModel({
                        purchaseOrder: oData.PurchaseOrder || "",
                        netAmount: oData.NetAmount != null ? String(oData.NetAmount) : "0",
                        grossAmount: oData.GrossAmount != null ? String(oData.GrossAmount) : "0",
                        currencyCode: oData.CurrencyCode || "",
                        deliveryAdress: oData.DeliveryAdress || "",
                        vendorAdress: oData.VendorAdress || "",
                        items: aItems
                    });

                    var oHeaderForm = new SimpleForm({
                        editable: true,
                        layout: "ResponsiveGridLayout",
                        labelSpanXL: 4,
                        labelSpanL: 4,
                        labelSpanM: 4,
                        labelSpanS: 12,
                        content: [
                            new Label({ text: "Purchase Order" }),
                            new Input({ value: "{edit>/purchaseOrder}", editable: false }),
                            new Label({ text: "Net Amount" }),
                            new Input({ value: "{edit>/netAmount}", type: "Number" }),
                            new Label({ text: "Gross Amount" }),
                            new Input({ value: "{edit>/grossAmount}", type: "Number" }),
                            new Label({ text: "Currency" }),
                            new Input({ value: "{edit>/currencyCode}" }),
                            new Label({ text: "Delivery Address" }),
                            new TextArea({ value: "{edit>/deliveryAdress}", rows: 2 }),
                            new Label({ text: "Vendor Address" }),
                            new TextArea({ value: "{edit>/vendorAdress}", rows: 2 })
                        ]
                    });

                    var oItemTemplate = new ColumnListItem({
                        cells: [
                            new Text({ text: "{edit>itemNumber}" }),
                            new Input({ value: "{edit>barcode}" }),
                            new Text({ text: "{edit>description}" }),
                            new Input({ value: "{edit>materialNumber}" }),
                            new Input({ value: "{edit>quantity}", type: "Number" }),
                            new Input({ value: "{edit>unitPrice}", type: "Number" })
                        ]
                    });

                    var oItemsTable = new Table({
                        headerText: "Items",
                        columns: [
                            new Column({ header: new Text({ text: "Item No" }), width: "5rem" }),
                            new Column({ header: new Text({ text: "Barcode" }) }),
                            new Column({ header: new Text({ text: "Description" }) }),
                            new Column({ header: new Text({ text: "Material" }) }),
                            new Column({ header: new Text({ text: "Qty" }) }),
                            new Column({ header: new Text({ text: "Unit Price" }) })
                        ]
                    });

                    oItemsTable.bindItems({
                        path: "edit>/items",
                        template: oItemTemplate
                    });

                    var oDialog = new Dialog({
                        title: "Edit Details",
                        contentWidth: "700px",
                        verticalScrolling: true,
                        content: [oHeaderForm, oItemsTable],
                        beginButton: new Button({
                            text: "Save",
                            type: "Emphasized",
                            press: function () {
                                var editData = oEditModel.getData();
                                var sServiceUrl = oModel.getServiceUrl();

                                fetch(sServiceUrl, {
                                    method: "HEAD",
                                    headers: { "X-Csrf-Token": "Fetch" }
                                })
                                .then(function (tokenResponse) {
                                    var sCsrfToken = tokenResponse.headers.get("X-Csrf-Token");
                                    return fetch(sServiceUrl + "updatePOLogData", {
                                        method: "POST",
                                        headers: {
                                            "Content-Type": "application/json",
                                            "X-Csrf-Token": sCsrfToken
                                        },
                                        body: JSON.stringify({
                                            uuid: oData.Uuid,
                                            headerData: JSON.stringify({
                                                netAmount: editData.netAmount,
                                                grossAmount: editData.grossAmount,
                                                currencyCode: editData.currencyCode,
                                                deliveryAdress: editData.deliveryAdress,
                                                vendorAdress: editData.vendorAdress
                                            }),
                                            itemsData: JSON.stringify(
                                                editData.items.map(function (item) {
                                                    return {
                                                        itemNumber: item.itemNumber,
                                                        barcode: item.barcode,
                                                        materialNumber: item.materialNumber,
                                                        quantity: item.quantity,
                                                        unit: item.unit,
                                                        unitPrice: item.unitPrice
                                                    };
                                                })
                                            )
                                        })
                                    });
                                })
                                .then(function (response) {
                                    if (!response.ok) {
                                        return response.text().then(function (txt) {
                                            var msg = "HTTP " + response.status;
                                            try {
                                                var j = JSON.parse(txt);
                                                if (j.error && j.error.message) {
                                                    msg = typeof j.error.message === "object" ? j.error.message.value : j.error.message;
                                                } else if (j.message) {
                                                    msg = j.message;
                                                }
                                            } catch (x) {}
                                            throw new Error(msg);
                                        });
                                    }
                                    return response.json();
                                })
                                .then(function (result) {
                                    if (result.success) {
                                        MessageToast.show("Operation Successful");
                                        oDialog.close();
                                        setTimeout(function () {
                                            window.location.reload();
                                        }, 300);
                                    } else {
                                        MessageToast.show("Save failed: " + (result.message || "Unknown error"));
                                    }
                                })
                                .catch(function (error) {
                                    MessageToast.show("Save failed: " + error.message);
                                });
                            }
                        }),
                        endButton: new Button({
                            text: "Cancel",
                            press: function () {
                                oDialog.close();
                            }
                        }),
                        afterClose: function () {
                            oDialog.destroy();
                        }
                    });

                    oDialog.setModel(oEditModel, "edit");
                    oDialog.open();
                });
            });
        }
    };
});
