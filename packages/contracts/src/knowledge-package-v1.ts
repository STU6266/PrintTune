import type { CanonicalUnit, FieldClaimValue } from "./field-claim.js";

export type KnowledgePackageType = "printer_series" | "component_catalog" | "firmware" | "slicer";

export interface KnowledgePackagePublisherV1 {
  readonly publisherId: string;
  readonly publisherDisplayName: string;
}

export interface KnowledgePackageCoreCompatibilityV1 {
  readonly minimumVersion: string;
  readonly maximumVersionExclusive?: string;
}

export interface KnowledgePackageV1<TType extends KnowledgePackageType, TPayload> {
  readonly formatVersion: 1;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly packageType: TType;
  readonly displayName: string;
  readonly description?: string;
  readonly publisher: KnowledgePackagePublisherV1;
  readonly coreCompatibility: KnowledgePackageCoreCompatibilityV1;
  readonly payload: TPayload;
}

export interface PackageFieldFactV1 {
  readonly factId: string;
  readonly fieldPath: string;
  readonly value: FieldClaimValue;
  readonly unit?: CanonicalUnit;
}

export interface PrinterModelVariantDefinitionV1 {
  readonly modelDefinitionId: string;
  readonly modelDisplayName: string;
  readonly facts: readonly PackageFieldFactV1[];
}

export interface PrinterSeriesDefinitionV1 {
  readonly seriesDefinitionId: string;
  readonly manufacturerDisplayName: string;
  readonly seriesDisplayName: string;
  readonly facts: readonly PackageFieldFactV1[];
  readonly models: readonly PrinterModelVariantDefinitionV1[];
}

export interface PrinterSeriesKnowledgePackagePayloadV1 {
  readonly series: PrinterSeriesDefinitionV1;
}

export type PrinterSeriesKnowledgePackageV1 = KnowledgePackageV1<
  "printer_series",
  PrinterSeriesKnowledgePackagePayloadV1
>;
