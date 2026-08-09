import type {
  ClaimTrust,
  FieldClaim,
  PrinterKnowledgeIdentity,
  PrinterSeriesKnowledgePackageV1,
  PrinterState,
} from "@printtune/contracts";
import { createFieldClaim, isStrictIsoUtcTimestamp } from "@printtune/core";

import {
  InvalidPrinterSeriesPackageCoreCompatibilityError,
  UnknownPrinterSeriesModelError,
  getEffectivePrinterSeriesFacts,
  type PrinterSeriesPackageCoreCompatibilityIssue,
} from "./printer-series-package-interpretation.js";

export type PackageKnowledgeTrust = Extract<ClaimTrust, "developer_verified" | "customer_verified">;

export type PrinterSeriesPackageClaimMaterializationErrorCode =
  | "identity_not_known"
  | "package_identity_mismatch"
  | "series_definition_mismatch"
  | "model_definition_not_found"
  | "printer_state_ownership_mismatch"
  | "invalid_package_trust"
  | "incompatible_package"
  | "invalid_materialization_context";

export class PrinterSeriesPackageClaimMaterializationError extends Error {
  override readonly name = "PrinterSeriesPackageClaimMaterializationError";

  constructor(
    readonly code: PrinterSeriesPackageClaimMaterializationErrorCode,
    readonly context?: Readonly<Record<string, unknown>>,
    readonly compatibilityIssues?: readonly PrinterSeriesPackageCoreCompatibilityIssue[]
  ) {
    super(`Unable to materialize printer-series package Claims: ${code}`);
  }
}

export interface MaterializePrinterSeriesPackageClaimsInput {
  readonly identity: PrinterKnowledgeIdentity;
  readonly package: PrinterSeriesKnowledgePackageV1;
  readonly printerState: PrinterState;
  readonly trust: PackageKnowledgeTrust;
  readonly createdAt: string;
  readonly createClaimId: () => string;
}

const PACKAGE_KNOWLEDGE_TRUSTS = new Set<PackageKnowledgeTrust>([
  "developer_verified",
  "customer_verified",
]);

function fail(
  code: PrinterSeriesPackageClaimMaterializationErrorCode,
  context?: Readonly<Record<string, unknown>>
): never {
  throw new PrinterSeriesPackageClaimMaterializationError(code, context);
}

export function materializePrinterSeriesPackageClaims(
  input: MaterializePrinterSeriesPackageClaimsInput
): readonly FieldClaim[] {
  const { identity, package: knowledgePackage, printerState } = input;

  if (identity.kind !== "known") fail("identity_not_known");
  if (
    identity.definitionRef.packageId !== knowledgePackage.packageId ||
    identity.definitionRef.packageVersion !== knowledgePackage.packageVersion
  ) {
    fail("package_identity_mismatch", {
      identityPackageId: identity.definitionRef.packageId,
      identityPackageVersion: identity.definitionRef.packageVersion,
      packageId: knowledgePackage.packageId,
      packageVersion: knowledgePackage.packageVersion,
    });
  }
  if (
    identity.definitionRef.seriesDefinitionId !== knowledgePackage.payload.series.seriesDefinitionId
  ) {
    fail("series_definition_mismatch", {
      identitySeriesDefinitionId: identity.definitionRef.seriesDefinitionId,
      packageSeriesDefinitionId: knowledgePackage.payload.series.seriesDefinitionId,
    });
  }
  if (identity.printerId !== printerState.printerId) {
    fail("printer_state_ownership_mismatch", {
      identityPrinterId: identity.printerId,
      printerStatePrinterId: printerState.printerId,
    });
  }
  if (!PACKAGE_KNOWLEDGE_TRUSTS.has(input.trust)) fail("invalid_package_trust");
  if (!isStrictIsoUtcTimestamp(input.createdAt)) fail("invalid_materialization_context");

  let effectiveFacts;
  try {
    effectiveFacts = getEffectivePrinterSeriesFacts(
      knowledgePackage,
      identity.definitionRef.modelDefinitionId
    );
  } catch (error) {
    if (error instanceof UnknownPrinterSeriesModelError) {
      fail("model_definition_not_found", { modelDefinitionId: error.modelDefinitionId });
    }
    if (error instanceof InvalidPrinterSeriesPackageCoreCompatibilityError) {
      throw new PrinterSeriesPackageClaimMaterializationError(
        "incompatible_package",
        undefined,
        error.issues
      );
    }
    throw error;
  }

  const claimIds = new Set<string>();
  const claims: FieldClaim[] = [];
  for (const fact of effectiveFacts) {
    try {
      const claimId = input.createClaimId();
      if (claimIds.has(claimId)) fail("invalid_materialization_context");
      const claim = createFieldClaim({
        id: claimId,
        target: { type: "printer_state", printerStateId: printerState.id },
        fieldPath: fact.fieldPath,
        value: fact.value,
        ...(fact.unit === undefined ? {} : { unit: fact.unit }),
        provenance: {
          sourceType: "knowledge_package",
          sourceRef: {
            type: "knowledge_package",
            packageId: knowledgePackage.packageId,
            packageVersion: knowledgePackage.packageVersion,
            factId: fact.factId,
          },
        },
        trust: input.trust,
        timestamp: input.createdAt,
      });
      claimIds.add(claimId);
      claims.push(claim);
    } catch (error) {
      if (error instanceof PrinterSeriesPackageClaimMaterializationError) throw error;
      fail("invalid_materialization_context");
    }
  }

  return Object.freeze(claims);
}
