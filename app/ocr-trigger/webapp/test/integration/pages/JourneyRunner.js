sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"com/jumbo/ocr/ocrtrigger/test/integration/pages/OCRLogsList",
	"com/jumbo/ocr/ocrtrigger/test/integration/pages/OCRLogsObjectPage"
], function (JourneyRunner, OCRLogsList, OCRLogsObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('com/jumbo/ocr/ocrtrigger') + '/test/flp.html#app-preview',
        pages: {
			onTheOCRLogsList: OCRLogsList,
			onTheOCRLogsObjectPage: OCRLogsObjectPage
        },
        async: true
    });

    return runner;
});

