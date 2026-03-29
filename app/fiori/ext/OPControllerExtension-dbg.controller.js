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
                    // Reset cached sales order when navigating to a new/different record
                    this._createdSalesOrder = null;

                    if (this._buttonsAdded) {
                        // Update existing buttons' binding context for the new record
                        var oView = this.base.getView();
                        var oEditBtn = oView.byId(oView.getId() + "--customEditBtn");
                        var oTriggerBtn = oView.byId(oView.getId() + "--customTriggerBtn");
                        if (oEditBtn) oEditBtn.setBindingContext(oBindingContext);
                        if (oTriggerBtn) oTriggerBtn.setBindingContext(oBindingContext);
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

            // Check locally cached sales order from previous trigger
            if (this._createdSalesOrder) {
                MessageBox.warning(
                    "Sales Order " + this._createdSalesOrder + " already created. Triggering again is not allowed.",
                    { title: "Trigger Not Allowed" }
                );
                return;
            }

            var oModel = oContext.getModel();

            // Use requestObject to get fresh data from OData V4 context
            oContext.requestObject().then(function (oData) {
                var sUuid = oData.Uuid;

                if (!sUuid) {
                    MessageToast.show("UUID not found");
                    return;
                }

                // Sales Order zaten oluşturulmuşsa trigger'a izin verme
                if (oData.SalesOrderNumber) {
                    that._createdSalesOrder = oData.SalesOrderNumber;
                    MessageBox.warning(
                        "Sales Order " + oData.SalesOrderNumber + " already created. Triggering again is not allowed.",
                        { title: "Trigger Not Allowed" }
                    );
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
            });
        },

        _executeTrigger: function (oModel, sUuid, oContext) {
            var that = this;
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

                // Step 2: Call triggerLog unbound action with UUID parameter
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
                if (!response.ok) {
                    // HTTP error - try to extract OData error message
                    return response.json().then(function (errData) {
                        var errMsg = "Unknown error (HTTP " + response.status + ")";
                        if (errData?.error?.message?.value) {
                            errMsg = errData.error.message.value;
                        } else if (errData?.error?.message) {
                            errMsg = typeof errData.error.message === "string"
                                ? errData.error.message
                                : JSON.stringify(errData.error.message);
                        } else if (errData?.message) {
                            errMsg = errData.message;
                        }
                        throw new Error(errMsg);
                    }).catch(function (parseErr) {
                        if (parseErr.message && parseErr.message !== "Unknown error (HTTP " + response.status + ")") {
                            throw parseErr;
                        }
                        throw new Error("HTTP " + response.status + ": " + response.statusText);
                    });
                }
                return response.json();
            })
            .then(function (result) {
                sap.ui.core.BusyIndicator.hide();

                // OData V4 action result may have fields at top level or in value
                var bSuccess = result.success || (result.value && result.value.success);
                var sMessage = result.message || (result.value && result.value.message) || "";
                var sSalesOrder = result.salesOrder || (result.value && result.value.salesOrder) || "";

                if (bSuccess) {
                    that._createdSalesOrder = sSalesOrder;
                    MessageBox.success(
                        "Sales Order " + sSalesOrder + " created successfully!",
                        {
                            title: "Success",
                            onClose: function () {
                                window.location.reload();
                            }
                        }
                    );
                } else {
                    MessageBox.error(
                        sMessage || "Sales order creation failed",
                        {
                            title: "Trigger Failed",
                            onClose: function () {
                                window.location.reload();
                            }
                        }
                    );
                }
            })
            .catch(function (error) {
                sap.ui.core.BusyIndicator.hide();
                MessageBox.error(
                    error.message || "Request failed",
                    {
                        title: "Trigger Failed",
                        onClose: function () {
                            window.location.reload();
                        }
                    }
                );
            });
        }
    });
});
