export interface PrinterKnowledgeSeriesSelection {
  readonly packageId: string;
  readonly packageVersion: string;
  readonly seriesDefinitionId: string;
}

export interface PrinterKnowledgeModelSelection extends PrinterKnowledgeSeriesSelection {
  readonly modelDefinitionId: string;
}

export interface PrinterKnowledgeCatalogModel {
  readonly selection: PrinterKnowledgeModelSelection;
  readonly modelDisplayName: string;
}

export interface PrinterKnowledgeCatalogItem {
  readonly selection: PrinterKnowledgeSeriesSelection;
  readonly manufacturerDisplayName: string;
  readonly seriesDisplayName: string;
  readonly models: readonly PrinterKnowledgeCatalogModel[];
}

export interface PrinterKnowledgeCatalog {
  readonly items: readonly PrinterKnowledgeCatalogItem[];
  readonly unusablePackageCount: number;
}

export interface ClassifyKnownPrinterCommand {
  readonly printerId: string;
  readonly selection: PrinterKnowledgeSeriesSelection | PrinterKnowledgeModelSelection;
}

export interface ClassifyUnclassifiedPrinterCommand {
  readonly printerId: string;
}

export type PrinterKnowledgeClassification =
  | { readonly kind: "unclassified" }
  | {
      readonly kind: "known";
      readonly selection: PrinterKnowledgeSeriesSelection | PrinterKnowledgeModelSelection;
      readonly manufacturerDisplayName: string;
      readonly seriesDisplayName: string;
      readonly modelDisplayName?: string;
    };

export interface PrinterKnowledgeClassificationResult {
  readonly status: "selected" | "already_selected";
  readonly classification: PrinterKnowledgeClassification;
}

export interface PrinterKnowledgeStateProjection {
  readonly id: string;
  readonly label: "Initialer Druckerzustand";
}

interface PrinterKnowledgeStatusBase {
  readonly printerState: PrinterKnowledgeStateProjection;
}

export type PrinterKnowledgeStatus = PrinterKnowledgeStatusBase &
  (
    | { readonly kind: "no_selection" }
    | { readonly kind: "unclassified" }
    | {
        readonly kind: "known";
        readonly manufacturerDisplayName: string;
        readonly seriesDisplayName: string;
        readonly modelDisplayName?: string;
        readonly packageAvailability: "available" | "unavailable" | "unusable";
      }
  );
