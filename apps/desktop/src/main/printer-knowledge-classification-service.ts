import type { PrinterKnowledgeIdentity } from "@printtune/contracts";
import {
  InvalidPrinterSeriesPackageCoreCompatibilityError,
  validatePrinterSeriesPackageCoreCompatibility,
} from "@printtune/knowledge-engine";
import {
  InvalidKnowledgePackageSemanticsError,
  InvalidKnowledgePackageStructureError,
  MalformedKnowledgePackageJsonError,
  UnsupportedKnowledgePackageFormatVersionError,
  UnsupportedKnowledgePackageTypeError,
  parseKnowledgePackageV1,
} from "@printtune/package-engine";

import type {
  ClassifyKnownPrinterCommand,
  ClassifyUnclassifiedPrinterCommand,
  PrinterKnowledgeClassification,
  PrinterKnowledgeClassificationResult,
  PrinterKnowledgeModelSelection,
  PrinterKnowledgeSeriesSelection,
} from "../shared/printer-knowledge-ui-api";
import { InstalledKnowledgePackageIntegrityError } from "./installed-knowledge-package-source";
import type { KnowledgePackageSource } from "./knowledge-package-source";
import type { PrinterKnowledgeIdentityApplicationService } from "./printer-knowledge-identity-application-service";

export class InvalidPrinterKnowledgeClassificationCommandError extends Error {
  override readonly name = "InvalidPrinterKnowledgeClassificationCommandError";
}

export class PrinterKnowledgePackageUnavailableError extends Error {
  override readonly name = "PrinterKnowledgePackageUnavailableError";
}

export class PrinterKnowledgePackageUnusableError extends Error {
  override readonly name = "PrinterKnowledgePackageUnusableError";
}

export class PrinterKnowledgePackageIncompatibleError extends Error {
  override readonly name = "PrinterKnowledgePackageIncompatibleError";
}

export class InvalidPrinterKnowledgeSeriesSelectionError extends Error {
  override readonly name = "InvalidPrinterKnowledgeSeriesSelectionError";
}

export class InvalidPrinterKnowledgeModelSelectionError extends Error {
  override readonly name = "InvalidPrinterKnowledgeModelSelectionError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function parseKnownCommand(value: unknown): ClassifyKnownPrinterCommand {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["printerId", "selection"]) ||
    !isValidId(value.printerId)
  ) {
    throw new InvalidPrinterKnowledgeClassificationCommandError();
  }
  const selection = value.selection;
  if (!isRecord(selection)) throw new InvalidPrinterKnowledgeClassificationCommandError();
  const hasModel = Object.hasOwn(selection, "modelDefinitionId");
  const keys = [
    "packageId",
    "packageVersion",
    "seriesDefinitionId",
    ...(hasModel ? ["modelDefinitionId"] : []),
  ];
  if (
    !hasExactKeys(selection, keys) ||
    !isValidId(selection.packageId) ||
    !isValidId(selection.packageVersion) ||
    !isValidId(selection.seriesDefinitionId) ||
    (hasModel && !isValidId(selection.modelDefinitionId))
  ) {
    throw new InvalidPrinterKnowledgeClassificationCommandError();
  }
  return {
    printerId: value.printerId,
    selection: hasModel
      ? {
          packageId: selection.packageId,
          packageVersion: selection.packageVersion,
          seriesDefinitionId: selection.seriesDefinitionId,
          modelDefinitionId: selection.modelDefinitionId as string,
        }
      : {
          packageId: selection.packageId,
          packageVersion: selection.packageVersion,
          seriesDefinitionId: selection.seriesDefinitionId,
        },
  };
}

function parseUnclassifiedCommand(value: unknown): ClassifyUnclassifiedPrinterCommand {
  if (!isRecord(value) || !hasExactKeys(value, ["printerId"]) || !isValidId(value.printerId)) {
    throw new InvalidPrinterKnowledgeClassificationCommandError();
  }
  return { printerId: value.printerId };
}

function sameKnownSelection(
  identity: PrinterKnowledgeIdentity | undefined,
  selection: PrinterKnowledgeSeriesSelection | PrinterKnowledgeModelSelection
): boolean {
  if (!identity || identity.kind !== "known") return false;
  const reference = identity.definitionRef;
  return (
    reference.packageId === selection.packageId &&
    reference.packageVersion === selection.packageVersion &&
    reference.seriesDefinitionId === selection.seriesDefinitionId &&
    reference.modelDefinitionId ===
      ("modelDefinitionId" in selection ? selection.modelDefinitionId : undefined)
  );
}

function result(
  status: PrinterKnowledgeClassificationResult["status"],
  classification: PrinterKnowledgeClassification
): PrinterKnowledgeClassificationResult {
  return Object.freeze({ status, classification: Object.freeze(classification) });
}

export class PrinterKnowledgeClassificationService {
  readonly #packageSource: KnowledgePackageSource;
  readonly #identities: PrinterKnowledgeIdentityApplicationService;

  constructor(
    packageSource: KnowledgePackageSource,
    identities: PrinterKnowledgeIdentityApplicationService
  ) {
    this.#packageSource = packageSource;
    this.#identities = identities;
  }

  async classifyKnownPrinter(command: unknown): Promise<PrinterKnowledgeClassificationResult> {
    const { printerId, selection } = parseKnownCommand(command);
    const current = await this.#identities.getCurrentIdentity(printerId);
    const classification = await this.#resolveKnownClassification(selection);
    if (sameKnownSelection(current, selection)) return result("already_selected", classification);

    await this.#identities.createAndSelect(printerId, {
      kind: "known",
      ...selection,
      manufacturerDisplayName: classification.manufacturerDisplayName,
      seriesDisplayName: classification.seriesDisplayName,
      ...(classification.modelDisplayName === undefined
        ? {}
        : { modelDisplayName: classification.modelDisplayName }),
    });
    return result("selected", classification);
  }

  async classifyUnclassifiedPrinter(
    command: unknown
  ): Promise<PrinterKnowledgeClassificationResult> {
    const { printerId } = parseUnclassifiedCommand(command);
    const current = await this.#identities.getCurrentIdentity(printerId);
    const classification = { kind: "unclassified" as const };
    if (current?.kind === "unclassified") return result("already_selected", classification);
    await this.#identities.createAndSelect(printerId, classification);
    return result("selected", classification);
  }

  async #resolveKnownClassification(
    selection: PrinterKnowledgeSeriesSelection | PrinterKnowledgeModelSelection
  ): Promise<Extract<PrinterKnowledgeClassification, { readonly kind: "known" }>> {
    let available;
    try {
      available = await this.#packageSource.getExactPackage(selection);
    } catch (error) {
      if (error instanceof InstalledKnowledgePackageIntegrityError) {
        throw new PrinterKnowledgePackageUnusableError();
      }
      throw error;
    }
    if (!available) throw new PrinterKnowledgePackageUnavailableError();

    let parsed;
    try {
      parsed = parseKnowledgePackageV1(available.text);
    } catch (error) {
      if (
        error instanceof MalformedKnowledgePackageJsonError ||
        error instanceof InvalidKnowledgePackageStructureError ||
        error instanceof InvalidKnowledgePackageSemanticsError ||
        error instanceof UnsupportedKnowledgePackageFormatVersionError ||
        error instanceof UnsupportedKnowledgePackageTypeError
      ) {
        throw new PrinterKnowledgePackageUnusableError();
      }
      throw error;
    }
    try {
      validatePrinterSeriesPackageCoreCompatibility(parsed);
    } catch (error) {
      if (error instanceof InvalidPrinterSeriesPackageCoreCompatibilityError) {
        throw new PrinterKnowledgePackageIncompatibleError();
      }
      throw error;
    }
    if (
      parsed.packageId !== selection.packageId ||
      parsed.packageVersion !== selection.packageVersion
    ) {
      throw new PrinterKnowledgePackageUnusableError();
    }
    const series = parsed.payload.series;
    if (series.seriesDefinitionId !== selection.seriesDefinitionId) {
      throw new InvalidPrinterKnowledgeSeriesSelectionError();
    }
    const model =
      "modelDefinitionId" in selection
        ? series.models.find(
            (candidate) => candidate.modelDefinitionId === selection.modelDefinitionId
          )
        : undefined;
    if ("modelDefinitionId" in selection && !model) {
      throw new InvalidPrinterKnowledgeModelSelectionError();
    }
    return Object.freeze({
      kind: "known",
      selection: Object.freeze({ ...selection }),
      manufacturerDisplayName: series.manufacturerDisplayName,
      seriesDisplayName: series.seriesDisplayName,
      ...(model === undefined ? {} : { modelDisplayName: model.modelDisplayName }),
    });
  }
}
