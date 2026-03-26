sap.ui.define([
    "sap/ui/core/mvc/ControllerExtension",
    "sap/m/Button"
], function (ControllerExtension, Button) {
    "use strict";

    return ControllerExtension.extend("com.jumbo.ocr.ocrtrigger.ext.OPControllerExtension", {
        override: {
            routing: {
                onAfterBinding: function (oBindingContext) {
                    this._currentContext = oBindingContext;

                    if (this._editBtnAdded) {
                        return;
                    }

                    var that = this;
                    setTimeout(function () {
                        that._addEditButton();
                    }, 300);
                }
            }
        },

        _addEditButton: function () {
            if (this._editBtnAdded) {
                return;
            }

            var that = this;
            var oView = this.base.getView();

            // Find the header actions toolbar (contains the Trigger button)
            var aToolbars = oView.findAggregatedObjects(true, function (oControl) {
                if (!oControl.isA("sap.m.OverflowToolbar")) {
                    return false;
                }
                var aContent = oControl.getContent();
                return aContent.some(function (oItem) {
                    return oItem.getText && oItem.getText() === "Trigger";
                });
            });

            if (aToolbars.length > 0) {
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

                // Set the binding context so the handler can access data
                if (that._currentContext) {
                    oEditButton.setBindingContext(that._currentContext);
                }

                aToolbars[0].insertContent(oEditButton, 0);
                this._editBtnAdded = true;
            }
        }
    });
});