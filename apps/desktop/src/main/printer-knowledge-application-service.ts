import { randomUUID } from "node:crypto";

import type { PrinterKnowledgeIdentity, PrinterState } from "@printtune/contracts";
import {
  KNOWLEDGE_PACKAGE_CORE_CONTRACT_VERSION,
  createPackageApplication,
  createPackageApplicationKey,
} from "@printtune/core";
import { materializePrinterSeriesPackageClaims } from "@printtune/knowledge-engine";
import { parseKnowledgePackageV1 } from "@printtune/package-engine";
import type {
  PackageApplicationLifecyclePersistence,
  PackageApplicationRepository,
  PrinterKnowledgeIdentityRepository,
  PrinterKnowledgeIdentitySelectionPersistence,
  PrinterRepository,
  PrinterStateRepository,
} from "@printtune/storage";

import type { ActiveWorkspaceSession } from "./active-workspace-session";
import type { KnowledgePackageSource } from "./knowledge-package-source";
import { CurrentPrinterKnowledgeIdentityNotFoundError } from "./printer-knowledge-identity-application-service";
import { NoActiveWorkspaceError, PrinterNotFoundError } from "./printer-flow-application-service";

export interface ApplyCurrentKnowledgeToPrinterStateInput {
  readonly printerId: string;
  readonly printerStateId: string;
}

export interface AppliedPrinterKnowledgeResult {
  readonly status: "applied" | "already_applied";
  readonly printerId: string;
  readonly printerStateId: string;
}

export type PrinterKnowledgeApplicationStatus =
  | { readonly kind: "no_selection" }
  | { readonly kind: "unclassified" }
  | { readonly kind: "known"; readonly applicationStatus: "not_applied" | "applied" };

export type PrinterKnowledgeApplicationErrorCode =
  | "invalid_command"
  | "printer_state_not_found"
  | "printer_state_ownership_mismatch"
  | "no_current_knowledge_identity"
  | "current_identity_unclassified"
  | "knowledge_package_not_available"
  | "invalid_knowledge_package"
  | "knowledge_materialization_failed"
  | "knowledge_persistence_failed";

export class PrinterKnowledgeApplicationError extends Error {
  override readonly name = "PrinterKnowledgeApplicationError";

  constructor(
    readonly code: PrinterKnowledgeApplicationErrorCode,
    readonly context?: Readonly<Record<string, string>>,
    options?: ErrorOptions
  ) {
    super(`Unable to apply current Printer knowledge: ${code}`, options);
  }
}

interface PrinterKnowledgeApplicationServiceDependencies {
  readonly createApplicationId?: () => string;
  readonly createClaimId?: () => string;
  readonly now?: () => string;
}

export class PrinterKnowledgeApplicationService {
  readonly #printers: PrinterRepository;
  readonly #states: PrinterStateRepository;
  readonly #identities: PrinterKnowledgeIdentityRepository;
  readonly #selection: PrinterKnowledgeIdentitySelectionPersistence;
  readonly #packageSource: KnowledgePackageSource;
  readonly #applications: PackageApplicationRepository;
  readonly #applicationLifecycle: PackageApplicationLifecyclePersistence;
  readonly #activeWorkspace: ActiveWorkspaceSession;
  readonly #createApplicationId: () => string;
  readonly #createClaimId: () => string;
  readonly #now: () => string;

  constructor(
    printers: PrinterRepository,
    states: PrinterStateRepository,
    identities: PrinterKnowledgeIdentityRepository,
    selection: PrinterKnowledgeIdentitySelectionPersistence,
    packageSource: KnowledgePackageSource,
    applications: PackageApplicationRepository,
    applicationLifecycle: PackageApplicationLifecyclePersistence,
    activeWorkspace: ActiveWorkspaceSession,
    dependencies: PrinterKnowledgeApplicationServiceDependencies = {}
  ) {
    this.#printers = printers;
    this.#states = states;
    this.#identities = identities;
    this.#selection = selection;
    this.#packageSource = packageSource;
    this.#applications = applications;
    this.#applicationLifecycle = applicationLifecycle;
    this.#activeWorkspace = activeWorkspace;
    this.#createApplicationId = dependencies.createApplicationId ?? randomUUID;
    this.#createClaimId = dependencies.createClaimId ?? randomUUID;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async applyCurrentKnowledgeToPrinterState(
    input: ApplyCurrentKnowledgeToPrinterStateInput
  ): Promise<AppliedPrinterKnowledgeResult> {
    const command = validateCommand(input);
    const printerState = await this.#authorizeTarget(command);
    const identity = await this.#getCurrentIdentity(command.printerId);
    if (!identity) {
      throw new PrinterKnowledgeApplicationError("no_current_knowledge_identity", {
        printerId: command.printerId,
      });
    }
    if (identity.kind === "unclassified") {
      throw new PrinterKnowledgeApplicationError("current_identity_unclassified");
    }

    const key = createPackageApplicationKey({
      printerStateId: command.printerStateId,
      packageId: identity.definitionRef.packageId,
      packageVersion: identity.definitionRef.packageVersion,
      seriesDefinitionId: identity.definitionRef.seriesDefinitionId,
      ...(identity.definitionRef.modelDefinitionId === undefined
        ? {}
        : { modelDefinitionId: identity.definitionRef.modelDefinitionId }),
      coreContractVersion: KNOWLEDGE_PACKAGE_CORE_CONTRACT_VERSION,
    });
    if (await this.#applications.findBySemanticKey(key)) {
      return result("already_applied", command);
    }

    const reference = Object.freeze({
      packageId: identity.definitionRef.packageId,
      packageVersion: identity.definitionRef.packageVersion,
    });
    const availablePackage = await this.#packageSource.getExactPackage(reference);
    if (!availablePackage) {
      throw new PrinterKnowledgeApplicationError("knowledge_package_not_available", reference);
    }

    let knowledgePackage;
    try {
      knowledgePackage = parseKnowledgePackageV1(availablePackage.text);
    } catch (cause) {
      throw new PrinterKnowledgeApplicationError("invalid_knowledge_package", reference, { cause });
    }

    const timestamp = this.#now();
    let claims;
    try {
      claims = materializePrinterSeriesPackageClaims({
        identity,
        package: knowledgePackage,
        printerState,
        trust: availablePackage.trust,
        createdAt: timestamp,
        createClaimId: this.#createClaimId,
      });
    } catch (cause) {
      throw new PrinterKnowledgeApplicationError("knowledge_materialization_failed", reference, {
        cause,
      });
    }

    const application = createPackageApplication({
      id: this.#createApplicationId(),
      printerId: command.printerId,
      printerStateId: command.printerStateId,
      printerKnowledgeIdentityId: identity.id,
      packageId: identity.definitionRef.packageId,
      packageVersion: identity.definitionRef.packageVersion,
      seriesDefinitionId: identity.definitionRef.seriesDefinitionId,
      ...(identity.definitionRef.modelDefinitionId === undefined
        ? {}
        : { modelDefinitionId: identity.definitionRef.modelDefinitionId }),
      coreContractVersion: KNOWLEDGE_PACKAGE_CORE_CONTRACT_VERSION,
      packageTrust: availablePackage.trust,
      timestamp,
    });

    try {
      const persisted = await this.#applicationLifecycle.applyOnce(application, claims);
      return result(persisted.status, command);
    } catch (cause) {
      throw new PrinterKnowledgeApplicationError("knowledge_persistence_failed", reference, {
        cause,
      });
    }
  }

  async getApplicationStatus(
    input: ApplyCurrentKnowledgeToPrinterStateInput
  ): Promise<PrinterKnowledgeApplicationStatus> {
    const command = validateCommand(input);
    await this.#authorizeTarget(command);
    const identity = await this.#getCurrentIdentity(command.printerId);
    if (!identity) return Object.freeze({ kind: "no_selection" });
    if (identity.kind === "unclassified") return Object.freeze({ kind: "unclassified" });
    const existing = await this.#applications.findBySemanticKey(
      createPackageApplicationKey({
        printerStateId: command.printerStateId,
        packageId: identity.definitionRef.packageId,
        packageVersion: identity.definitionRef.packageVersion,
        seriesDefinitionId: identity.definitionRef.seriesDefinitionId,
        ...(identity.definitionRef.modelDefinitionId === undefined
          ? {}
          : { modelDefinitionId: identity.definitionRef.modelDefinitionId }),
        coreContractVersion: KNOWLEDGE_PACKAGE_CORE_CONTRACT_VERSION,
      })
    );
    return Object.freeze({
      kind: "known",
      applicationStatus: existing ? "applied" : "not_applied",
    });
  }

  async #authorizeTarget(input: ApplyCurrentKnowledgeToPrinterStateInput): Promise<PrinterState> {
    const workspace = await this.#activeWorkspace.getActiveWorkspace();
    if (!workspace) throw new NoActiveWorkspaceError();
    const printer = await this.#printers.findById(input.printerId);
    if (!printer || printer.workspaceId !== workspace.id)
      throw new PrinterNotFoundError(input.printerId);
    const state = await this.#states.findById(input.printerStateId);
    if (!state) {
      throw new PrinterKnowledgeApplicationError("printer_state_not_found", {
        printerStateId: input.printerStateId,
      });
    }
    if (state.printerId !== printer.id) {
      throw new PrinterKnowledgeApplicationError("printer_state_ownership_mismatch", {
        printerId: printer.id,
        printerStateId: state.id,
      });
    }
    return state;
  }

  async #getCurrentIdentity(printerId: string): Promise<PrinterKnowledgeIdentity | undefined> {
    const identityId = await this.#selection.getSelectedIdentityId(printerId);
    if (!identityId) return undefined;
    const identity = await this.#identities.findById(identityId);
    if (!identity) throw new CurrentPrinterKnowledgeIdentityNotFoundError(identityId);
    return identity;
  }
}

function validateCommand(input: unknown): ApplyCurrentKnowledgeToPrinterStateInput {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).length !== 2 ||
    !("printerId" in input) ||
    !("printerStateId" in input) ||
    typeof input.printerId !== "string" ||
    input.printerId.length === 0 ||
    input.printerId.trim() !== input.printerId ||
    typeof input.printerStateId !== "string" ||
    input.printerStateId.length === 0 ||
    input.printerStateId.trim() !== input.printerStateId
  ) {
    throw new PrinterKnowledgeApplicationError("invalid_command");
  }
  return Object.freeze({ printerId: input.printerId, printerStateId: input.printerStateId });
}

function result(
  status: "applied" | "already_applied",
  input: ApplyCurrentKnowledgeToPrinterStateInput
): AppliedPrinterKnowledgeResult {
  return Object.freeze({
    status,
    printerId: input.printerId,
    printerStateId: input.printerStateId,
  });
}
