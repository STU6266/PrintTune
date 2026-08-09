export interface PrinterKnowledgeDefinitionReference {
  readonly packageId: string;
  readonly packageVersion: string;
  readonly seriesDefinitionId: string;
  readonly modelDefinitionId?: string;
}

interface PrinterKnowledgeIdentityBase {
  readonly id: string;
  readonly printerId: string;
  readonly selectedAt: string;
}

export interface KnownPrinterKnowledgeIdentity extends PrinterKnowledgeIdentityBase {
  readonly kind: "known";
  readonly definitionRef: PrinterKnowledgeDefinitionReference;
  readonly manufacturerDisplayName: string;
  readonly seriesDisplayName: string;
  readonly modelDisplayName?: string;
}

export interface UnclassifiedPrinterKnowledgeIdentity extends PrinterKnowledgeIdentityBase {
  readonly kind: "unclassified";
}

export type PrinterKnowledgeIdentity =
  KnownPrinterKnowledgeIdentity | UnclassifiedPrinterKnowledgeIdentity;
