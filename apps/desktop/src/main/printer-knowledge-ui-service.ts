import type { Printer, PrinterKnowledgeIdentity, PrinterState } from "@printtune/contracts";
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
  InstalledKnowledgePackageRepository,
  PrinterKnowledgeIdentityRepository,
  PrinterKnowledgeIdentitySelectionPersistence,
  PrinterRepository,
  PrinterStateRepository,
} from "@printtune/storage";

import type {
  PrinterKnowledgeCatalog,
  PrinterKnowledgeCatalogItem,
  PrinterKnowledgeCatalogModel,
  PrinterKnowledgeStatus,
} from "../shared/printer-knowledge-ui-api";
import type { ActiveWorkspaceSession } from "./active-workspace-session";
import { InstalledKnowledgePackageIntegrityError } from "./installed-knowledge-package-source";
import type { KnowledgePackageSource } from "./knowledge-package-source";
import { CurrentPrinterKnowledgeIdentityNotFoundError } from "./printer-knowledge-identity-application-service";
import { NoActiveWorkspaceError, PrinterNotFoundError } from "./printer-flow-application-service";

export class InitialPrinterStateNotFoundError extends Error {
  override readonly name = "InitialPrinterStateNotFoundError";

  constructor(readonly printerId: string) {
    super(`Initial PrinterState not found for Printer: ${printerId}`);
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareModels(
  left: PrinterKnowledgeCatalogModel,
  right: PrinterKnowledgeCatalogModel
): number {
  return (
    compareText(left.modelDisplayName, right.modelDisplayName) ||
    compareText(left.selection.modelDefinitionId, right.selection.modelDefinitionId)
  );
}

function compareCatalogItems(
  left: PrinterKnowledgeCatalogItem,
  right: PrinterKnowledgeCatalogItem
): number {
  return (
    compareText(left.manufacturerDisplayName, right.manufacturerDisplayName) ||
    compareText(left.seriesDisplayName, right.seriesDisplayName) ||
    compareText(left.selection.packageId, right.selection.packageId) ||
    compareText(left.selection.packageVersion, right.selection.packageVersion)
  );
}

function isExpectedUnusablePackageError(error: unknown): boolean {
  return (
    error instanceof InstalledKnowledgePackageIntegrityError ||
    error instanceof MalformedKnowledgePackageJsonError ||
    error instanceof InvalidKnowledgePackageStructureError ||
    error instanceof InvalidKnowledgePackageSemanticsError ||
    error instanceof UnsupportedKnowledgePackageFormatVersionError ||
    error instanceof UnsupportedKnowledgePackageTypeError ||
    error instanceof InvalidPrinterSeriesPackageCoreCompatibilityError
  );
}

function projectCatalogItem(
  packageId: string,
  packageVersion: string,
  value: ReturnType<typeof parseKnowledgePackageV1>
): PrinterKnowledgeCatalogItem | undefined {
  if (value.packageId !== packageId || value.packageVersion !== packageVersion) return undefined;
  const { series } = value.payload;
  const selection = Object.freeze({
    packageId,
    packageVersion,
    seriesDefinitionId: series.seriesDefinitionId,
  });
  const models = Object.freeze(
    series.models
      .map((model): PrinterKnowledgeCatalogModel =>
        Object.freeze({
          selection: Object.freeze({
            ...selection,
            modelDefinitionId: model.modelDefinitionId,
          }),
          modelDisplayName: model.modelDisplayName,
        })
      )
      .sort(compareModels)
  );
  return Object.freeze({
    selection,
    manufacturerDisplayName: series.manufacturerDisplayName,
    seriesDisplayName: series.seriesDisplayName,
    models,
  });
}

export class PrinterKnowledgeUiService {
  readonly #installedPackages: InstalledKnowledgePackageRepository;
  readonly #packageSource: KnowledgePackageSource;
  readonly #identities: PrinterKnowledgeIdentityRepository;
  readonly #selection: PrinterKnowledgeIdentitySelectionPersistence;
  readonly #printers: PrinterRepository;
  readonly #states: PrinterStateRepository;
  readonly #activeWorkspace: ActiveWorkspaceSession;

  constructor(
    installedPackages: InstalledKnowledgePackageRepository,
    packageSource: KnowledgePackageSource,
    identities: PrinterKnowledgeIdentityRepository,
    selection: PrinterKnowledgeIdentitySelectionPersistence,
    printers: PrinterRepository,
    states: PrinterStateRepository,
    activeWorkspace: ActiveWorkspaceSession
  ) {
    this.#installedPackages = installedPackages;
    this.#packageSource = packageSource;
    this.#identities = identities;
    this.#selection = selection;
    this.#printers = printers;
    this.#states = states;
    this.#activeWorkspace = activeWorkspace;
  }

  async listCatalog(): Promise<PrinterKnowledgeCatalog> {
    const installed = await this.#installedPackages.list();
    const items: PrinterKnowledgeCatalogItem[] = [];
    let unusablePackageCount = 0;

    for (const record of installed) {
      try {
        const available = await this.#packageSource.getExactPackage({
          packageId: record.packageId,
          packageVersion: record.packageVersion,
        });
        if (!available) {
          unusablePackageCount += 1;
          continue;
        }
        const parsed = parseKnowledgePackageV1(available.text);
        validatePrinterSeriesPackageCoreCompatibility(parsed);
        const item = projectCatalogItem(record.packageId, record.packageVersion, parsed);
        if (item) items.push(item);
        else unusablePackageCount += 1;
      } catch (error) {
        if (!isExpectedUnusablePackageError(error)) throw error;
        unusablePackageCount += 1;
      }
    }

    return Object.freeze({
      items: Object.freeze(items.sort(compareCatalogItems)),
      unusablePackageCount,
    });
  }

  async getPrinterKnowledgeStatus(printerId: string): Promise<PrinterKnowledgeStatus> {
    const printer = await this.#authorizePrinter(printerId);
    const printerState = await this.#getInitialState(printer);
    const stateProjection = Object.freeze({
      id: printerState.id,
      label: "Initialer Druckerzustand" as const,
    });
    const identityId = await this.#selection.getSelectedIdentityId(printer.id);
    if (identityId === undefined) {
      return Object.freeze({ kind: "no_selection", printerState: stateProjection });
    }
    const identity = await this.#identities.findById(identityId);
    if (!identity) throw new CurrentPrinterKnowledgeIdentityNotFoundError(identityId);
    if (identity.printerId !== printer.id)
      throw new CurrentPrinterKnowledgeIdentityNotFoundError(identityId);
    if (identity.kind === "unclassified") {
      return Object.freeze({ kind: "unclassified", printerState: stateProjection });
    }

    return Object.freeze({
      kind: "known",
      printerState: stateProjection,
      manufacturerDisplayName: identity.manufacturerDisplayName,
      seriesDisplayName: identity.seriesDisplayName,
      ...(identity.modelDisplayName === undefined
        ? {}
        : { modelDisplayName: identity.modelDisplayName }),
      packageAvailability: await this.#getPackageAvailability(identity),
    });
  }

  async #authorizePrinter(printerId: string): Promise<Printer> {
    const workspace = await this.#activeWorkspace.getActiveWorkspace();
    if (!workspace) throw new NoActiveWorkspaceError();
    const printer = await this.#printers.findById(printerId);
    if (!printer || printer.workspaceId !== workspace.id) throw new PrinterNotFoundError(printerId);
    return printer;
  }

  async #getInitialState(printer: Printer): Promise<PrinterState> {
    const state = (await this.#states.listByPrinterId(printer.id))[0];
    if (!state || state.printerId !== printer.id)
      throw new InitialPrinterStateNotFoundError(printer.id);
    return state;
  }

  async #getPackageAvailability(
    identity: Extract<PrinterKnowledgeIdentity, { readonly kind: "known" }>
  ): Promise<"available" | "unavailable" | "unusable"> {
    try {
      const available = await this.#packageSource.getExactPackage({
        packageId: identity.definitionRef.packageId,
        packageVersion: identity.definitionRef.packageVersion,
      });
      if (!available) return "unavailable";
      const parsed = parseKnowledgePackageV1(available.text);
      validatePrinterSeriesPackageCoreCompatibility(parsed);
      if (
        parsed.packageId !== identity.definitionRef.packageId ||
        parsed.packageVersion !== identity.definitionRef.packageVersion ||
        parsed.payload.series.seriesDefinitionId !== identity.definitionRef.seriesDefinitionId
      ) {
        return "unusable";
      }
      if (
        identity.definitionRef.modelDefinitionId !== undefined &&
        !parsed.payload.series.models.some(
          (model) => model.modelDefinitionId === identity.definitionRef.modelDefinitionId
        )
      ) {
        return "unusable";
      }
      return "available";
    } catch (error) {
      if (isExpectedUnusablePackageError(error)) return "unusable";
      throw error;
    }
  }
}
