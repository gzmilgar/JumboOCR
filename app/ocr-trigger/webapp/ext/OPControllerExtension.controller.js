sap.ui.define([
    "sap/ui/core/mvc/ControllerExtension",
    "sap/m/Button",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (ControllerExtension, Button, MessageToast, MessageBox) {
    "use strict";

    return ControllerExtension.extend("com.jumbo.ocr.ocrtrigger.ext.OPControllerExtension", {
        override: {
            routing: {
                onAfterBinding: function (oBindingContext) {
                    this._currentContext = oBindingContext;

                    if (this._buttonsAdded) {
                        return;
                    }

                    var that = this;
                    setTimeout(function () {
                        that._addCustomButtons();
                    }, 500);
                }
            }
        },

        _addCustomButtons: function () {
            if (this._buttonsAdded) {
                return;
            }

            var that = this;
            var oView = this.base.getView();

            // Find any OverflowToolbar in the ObjectPage header
            var aToolbars = oView.findAggregatedObjects(true, function (oControl) {
                return oControl.isA("sap.m.OverflowToolbar");
            });

            if (aToolbars.length === 0) {
                return;
            }

            var oToolbar = aToolbars[0];

            // --- TRIGGER BUTTON ---
            var oTriggerButton = new Button(oView.getId() + "--customTriggerBtn", {
                text: "Trigger",
                type: "Accept",
                icon: "sap-icon://initiative",
                press: function () {
                    that._onTriggerPress();
                }
            });

            // --- EDIT BUTTON ---
            var oEditButton = new Button(oView.getId() + "--customEditBtn", {
                text: "Edit",
                type: "Emphasized",
                icon: "sap-icon://edit",
                press: function (oEvent) {
                    sap.ui.require(
                        ["com/jumbo/ocr/ocrtrigger/ext/ObjectPageExt"],
                        function (handler) {
                            handler.onEditPress(oEvent);
                        }
                    );
                }
            });

            if (that._currentContext) {
                oEditButton.setBindingContext(that._currentContext);
                oTriggerButton.setBindingContext(that._currentContext);
            }

            oToolbar.insertContent(oTriggerButton, 0);
            oToolbar.insertContent(oEditButton, 1);
            this._buttonsAdded = true;
        },

        _onTriggerPress: function () {
            var that = this;
            var oContext = this._currentContext;

            if (!oContext) {
                MessageToast.show("No data context available");
                return;
            }

            var oModel = oContext.getModel();
            var oData = oContext.getObject();
            var sUuid = oData.Uuid;

            if (!sUuid) {
                MessageToast.show("UUID not found");
                return;
            }

            MessageBox.confirm(
                "Are you sure you want to trigger Sales Order creation for PO: " + (oData.PurchaseOrder || sUuid) + "?",
                {
                    title: "Confirm Trigger",
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.OK) {
                            that._executeTrigger(oModel, sUuid, oContext);
                        }
                    }
                }
            );
        },

        _executeTrigger: function (oModel, sUuid, oContext) {
            var sServiceUrl = oModel.getServiceUrl();

            // Show busy indicator
            sap.ui.core.BusyIndicator.show(0);

            // Step 1: Fetch CSRF token
            fetch(sServiceUrl, {
                method: "HEAD",
                headers: { "X-Csrf-Token": "Fetch" }
            })
            .then(function (tokenResponse) {
                var sCsrfToken = tokenResponse.headers.get("X-Csrf-Token");

                // Step 2: Call triggerLog action
                return fetch(sServiceUrl + "triggerLog", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Csrf-Token": sCsrfToken
                    },
                    body: JSON.stringify({ uuid: sUuid })
                });
            })
            .then(function (response) {
                return response.json();
            })
            .then(function (result) {
                sap.ui.core.BusyIndicator.hide();

                if (result.success) {
                    MessageBox.success(
                        "Sales Order " + result.salesOrder + " created successfully!",
                        {
                            title: "Success",
                            onClose: function () {
                                // Refresh the page data
                                oContext.refresh();
                            }
                        }
                    );
                } else {
                    MessageBox.error(
                        result.message || "Sales order creation failed",
                        { title: "Trigger Failed" }
                    );
                    // Refresh to show updated status
                    oContext.refresh();
                }
            })
            .catch(function (error) {
                sap.ui.core.BusyIndicator.hide();
                MessageBox.error(
                    "Request failed: " + error.message,
                    { title: "Error" }
                );
            });
        }
    });
});
