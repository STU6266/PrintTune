import { randomUUID } from "node:crypto";

import type { PrinterKnowledgeIdentity, PrinterState } from "@printtune/contracts";
import { materializePrinterSeriesPackageClaims } from "@printtune/knowledge-engine";
import { parseKnowledgePackageV1 } from "@printtune/package-engine";
import type {
  FieldClaimRepository,
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
  readonly printerId: string;
  readonly printerStateId: string;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly claimIds: readonly string[];
}

export type PrinterKnowledgeApplicationErrorCode =
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
  readonly createClaimId?: () => string;
  readonly now?: () => string;
}

export class PrinterKnowledgeApplicationService {
  readonly #printers: PrinterRepository;
  readonly #states: PrinterStateRepository;
  readonly #identities: PrinterKnowledgeIdentityRepository;
  readonly #selection: PrinterKnowledgeIdentitySelectionPersistence;
  readonly #packageSource: KnowledgePackageSource;
  readonly #claims: FieldClaimRepository;
  readonly #activeWorkspace: ActiveWorkspaceSession;
  readonly #createClaimId: () => string;
  readonly #now: () => string;

  constructor(
    printers: PrinterRepository,
    states: PrinterStateRepository,
    identities: PrinterKnowledgeIdentityRepository,
    selection: PrinterKnowledgeIdentitySelectionPersistence,
    packageSource: KnowledgePackageSource,
    claims: FieldClaimRepository,
    activeWorkspace: ActiveWorkspaceSession,
    dependencies: PrinterKnowledgeApplicationServiceDependencies = {}
  ) {
    this.#printers = printers;
    this.#states = states;
    this.#identities = identities;
    this.#selection = selection;
    this.#packageSource = packageSource;
    this.#claims = claims;
    this.#activeWorkspace = activeWorkspace;
    this.#createClaimId = dependencies.createClaimId ?? randomUUID;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async applyCurrentKnowledgeToPrinterState(
    input: ApplyCurrentKnowledgeToPrinterStateInput
  ): Promise<AppliedPrinterKnowledgeResult> {
    const printerState = await this.#authorizeTarget(input);
    const identity = await this.#getCurrentIdentity(input.printerId);
    if (identity.kind === "unclassified") {
      throw new PrinterKnowledgeApplicationError("current_identity_unclassified");
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
      throw new PrinterKnowledgeApplicationError("invalid_knowledge_package", reference, {
        cause,
      });
    }

    let claims;
    try {
      claims = materializePrinterSeriesPackageClaims({
        identity,
        package: knowledgePackage,
        printerState,
        trust: availablePackage.trust,
        createdAt: this.#now(),
        createClaimId: this.#createClaimId,
      });
    } catch (cause) {
      throw new PrinterKnowledgeApplicationError("knowledge_materialization_failed", reference, {
        cause,
      });
    }

    try {
      await this.#claims.createBatch(claims);
    } catch (cause) {
      throw new PrinterKnowledgeApplicationError("knowledge_persistence_failed", reference, {
        cause,
      });
    }

    return Object.freeze({
      printerId: input.printerId,
      printerStateId: input.printerStateId,
      packageId: knowledgePackage.packageId,
      packageVersion: knowledgePackage.packageVersion,
      claimIds: Object.freeze(claims.map((claim) => claim.id)),
    });
  }

  async #authorizeTarget(input: ApplyCurrentKnowledgeToPrinterStateInput): Promise<PrinterState> {
    const workspace = await this.#activeWorkspace.getActiveWorkspace();
    if (!workspace) throw new NoActiveWorkspaceError();

    const printer = await this.#printers.findById(input.printerId);
    if (!printer || printer.workspaceId !== workspace.id) {
      throw new PrinterNotFoundError(input.printerId);
    }

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

  async #getCurrentIdentity(printerId: string): Promise<PrinterKnowledgeIdentity> {
    const identityId = await this.#selection.getSelectedIdentityId(printerId);
    if (!identityId) {
      throw new PrinterKnowledgeApplicationError("no_current_knowledge_identity", { printerId });
    }
    const identity = await this.#identities.findById(identityId);
    if (!identity) throw new CurrentPrinterKnowledgeIdentityNotFoundError(identityId);
    return identity;
  }
}
