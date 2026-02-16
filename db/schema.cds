namespace jumbo.ocr;

// Audit log only - NO master data!
entity ProcessLog {
  key ID                    : UUID;
  timestamp                 : DateTime;
  documentNumber            : String(50);
  salesOrderNumber          : String(10);
  status                    : String(20);  // SUCCESS, FAILED
  errorMessage              : String(500);
  extractionData            : LargeString;  // JSON for debugging
  createdBy                 : String(100);
}