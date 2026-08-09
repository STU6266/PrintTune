export {
  InvalidPrinterSeriesEffectiveFactsError,
  InvalidPrinterSeriesPackageCoreCompatibilityError,
  UnknownPrinterSeriesModelError,
  getEffectivePrinterSeriesFacts,
  validatePrinterSeriesPackageCoreCompatibility,
  type PrinterSeriesPackageCoreCompatibilityIssue,
  type PrinterSeriesPackageCoreCompatibilityIssueCode,
  type IncompatibleCoreVersionIssue,
  type PrinterSeriesPackageFactCompatibilityIssue,
} from "./printer-series-package-interpretation.js";
export {
  PrinterSeriesPackageClaimMaterializationError,
  materializePrinterSeriesPackageClaims,
  type MaterializePrinterSeriesPackageClaimsInput,
  type PackageKnowledgeTrust,
  type PrinterSeriesPackageClaimMaterializationErrorCode,
} from "./printer-series-package-claim-materializer.js";
