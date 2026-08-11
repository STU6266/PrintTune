import { randomUUID } from "node:crypto";

import type { FieldClaim, Printer, PrinterState, Workspace } from "@printtune/contracts";
import {
  assessFieldClaimCarryForward,
  createPrinterStateTransitionPlan,
  findCoreFieldDefinition,
} from "@printtune/core";
import {
  PrinterStateTransitionCommandConflictError,
  StalePrinterStateTransitionSourceError,
  type ComponentInstallationRepository,
  type FieldClaimRepository,
  type PrinterRepository,
  type PrinterStateRepository,
  type PrinterStateSelectionPersistence,
  type PrinterStateTransitionLifecyclePersistence,
} from "@printtune/storage";

import type {
  CreatePrinterStateTransitionCommand,
  PrinterStateOverview,
  PrinterStateTransitionPreparation,
  PrinterStateTransitionResult,
  TransitionClaimChoice,
} from "../shared/printer-state-lifecycle-api.js";
import { assertCreatePrinterStateTransitionCommand } from "../shared/printer-state-lifecycle-api.js";
import type { ActiveWorkspaceSession } from "./active-workspace-session.js";
import {
  NoActiveWorkspaceError,
  PrinterNotFoundError,
} from "./printer-flow-application-service.js";

export type PrinterStateLifecycleErrorCode =
  | "missing_working_state"
  | "missing_source_state"
  | "stale_transition_context"
  | "command_conflict"
  | "invalid_component_decisions"
  | "invalid_claim_decision"
  | "transition_plan_invalid"
  | "transition_persistence_failed";

export class PrinterStateLifecycleApplicationError extends Error {
  override readonly name = "PrinterStateLifecycleApplicationError";
  constructor(
    readonly code: PrinterStateLifecycleErrorCode,
    options?: ErrorOptions
  ) {
    super(`PrinterState lifecycle operation failed: ${code}`, options);
  }
}

export interface PrinterStateLifecycleDependencies {
  readonly createPrinterStateId?: () => string;
  readonly createComponentInstallationId?: () => string;
  readonly createComponentInstanceId?: () => string;
  readonly createClaimId?: () => string;
  readonly now?: () => string;
}

export class PrinterStateLifecycleApplicationService {
  readonly #activeWorkspace: ActiveWorkspaceSession;
  readonly #printers: PrinterRepository;
  readonly #states: PrinterStateRepository;
  readonly #selection: PrinterStateSelectionPersistence;
  readonly #components: ComponentInstallationRepository;
  readonly #claims: FieldClaimRepository;
  readonly #lifecycle: PrinterStateTransitionLifecyclePersistence;
  readonly #createPrinterStateId: () => string;
  readonly #createComponentInstallationId: () => string;
  readonly #createComponentInstanceId: () => string;
  readonly #createClaimId: () => string;
  readonly #now: () => string;

  constructor(
    activeWorkspace: ActiveWorkspaceSession,
    printers: PrinterRepository,
    states: PrinterStateRepository,
    selection: PrinterStateSelectionPersistence,
    components: ComponentInstallationRepository,
    claims: FieldClaimRepository,
    lifecycle: PrinterStateTransitionLifecyclePersistence,
    dependencies: PrinterStateLifecycleDependencies = {}
  ) {
    this.#activeWorkspace = activeWorkspace;
    this.#printers = printers;
    this.#states = states;
    this.#selection = selection;
    this.#components = components;
    this.#claims = claims;
    this.#lifecycle = lifecycle;
    this.#createPrinterStateId = dependencies.createPrinterStateId ?? randomUUID;
    this.#createComponentInstallationId = dependencies.createComponentInstallationId ?? randomUUID;
    this.#createComponentInstanceId = dependencies.createComponentInstanceId ?? randomUUID;
    this.#createClaimId = dependencies.createClaimId ?? randomUUID;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async getPrinterStateOverview(printerId: string): Promise<PrinterStateOverview> {
    const printer = await this.#authorizePrinter(printerId);
    const workingPrinterStateId = await this.#requireWorkingStateId(printer.id);
    const states = await this.#states.listByPrinterId(printer.id);
    if (!states.some(({ id }) => id === workingPrinterStateId)) {
      throw new PrinterStateLifecycleApplicationError("missing_working_state");
    }
    return Object.freeze({
      printerId: printer.id,
      workingPrinterStateId,
      states: Object.freeze(
        states.map((state) =>
          Object.freeze({
            printerStateId: state.id,
            ...(state.parentPrinterStateId === undefined
              ? {}
              : { parentPrinterStateId: state.parentPrinterStateId }),
            createdAt: state.createdAt,
            isWorking: state.id === workingPrinterStateId,
          })
        )
      ),
    });
  }

  async getTransitionPreparation(printerId: string): Promise<PrinterStateTransitionPreparation> {
    const printer = await this.#authorizePrinter(printerId);
    const sourceState = await this.#loadWorkingState(printer);
    const components = await this.#components.listByPrinterStateId(sourceState.id);
    const claims = await this.#claims.listByTarget({
      type: "printer_state",
      printerStateId: sourceState.id,
    });
    const claimCarryChoices: TransitionClaimChoice[] = [];
    const reconfirmationFields = [];
    for (const claim of claims) {
      if (claim.provenance.sourceType === "knowledge_package") continue;
      const definition = findCoreFieldDefinition(claim.fieldPath);
      const assessment = definition
        ? assessFieldClaimCarryForward({ claim, fieldDefinition: definition })
        : { status: "not_carryable" as const, reason: "unknown_field_definition" };
      const projected = Object.freeze({
        sourceClaimId: claim.id,
        fieldPath: claim.fieldPath,
        value: Object.freeze({ ...claim.value }),
        ...(claim.unit === undefined ? {} : { unit: claim.unit }),
        disposition: assessment.status,
        ...(assessment.status === "auto_carry" ? {} : { reason: assessment.reason }),
      });
      claimCarryChoices.push(projected);
      if (assessment.status === "reconfirmation_required") {
        reconfirmationFields.push(
          Object.freeze({
            fieldPath: claim.fieldPath,
            value: Object.freeze({ ...claim.value }),
            ...(claim.unit === undefined ? {} : { unit: claim.unit }),
          })
        );
      }
    }
    return Object.freeze({
      printerId: printer.id,
      sourcePrinterStateId: sourceState.id,
      components: Object.freeze(
        components.map(({ id, role, kind, displayName }) =>
          Object.freeze({ componentInstallationId: id, role, kind, displayName })
        )
      ),
      claimCarryChoices: Object.freeze(claimCarryChoices),
      reconfirmationFields: Object.freeze(reconfirmationFields),
    });
  }

  async createPrinterStateTransition(
    untrustedCommand: unknown
  ): Promise<PrinterStateTransitionResult> {
    const command = assertCreatePrinterStateTransitionCommand(untrustedCommand);
    const printer = await this.#authorizePrinter(command.printerId);
    const completed = await this.#lifecycle.findCompletedByCommandId(command.transitionCommandId);
    if (completed) {
      if (
        completed.printerId !== printer.id ||
        completed.sourcePrinterStateId !== command.expectedSourcePrinterStateId
      ) {
        throw new PrinterStateLifecycleApplicationError("command_conflict");
      }
      return this.#projectResult(
        "already_completed",
        completed.printerId,
        completed.sourcePrinterStateId,
        completed.targetPrinterStateId
      );
    }

    const selectedStateId = await this.#requireWorkingStateId(printer.id);
    if (selectedStateId !== command.expectedSourcePrinterStateId) {
      throw new PrinterStateLifecycleApplicationError("stale_transition_context");
    }
    const sourceState = await this.#states.findById(selectedStateId);
    if (!sourceState || sourceState.printerId !== printer.id) {
      throw new PrinterStateLifecycleApplicationError("missing_source_state");
    }
    const sourceComponents = await this.#components.listByPrinterStateId(sourceState.id);
    this.#validateComponentDecisions(
      command,
      sourceComponents.map(({ id }) => id)
    );
    const sourceClaims: Array<{ sourceClaim: FieldClaim; applicabilityConfirmed: boolean }> = [];
    for (const decision of command.claimCarryDecisions) {
      const claim = await this.#claims.findById(decision.sourceClaimId);
      if (
        !claim ||
        claim.target.type !== "printer_state" ||
        claim.target.printerStateId !== sourceState.id
      ) {
        throw new PrinterStateLifecycleApplicationError("invalid_claim_decision");
      }
      sourceClaims.push({
        sourceClaim: claim,
        applicabilityConfirmed: decision.applicabilityConfirmed,
      });
    }

    let plan;
    try {
      plan = createPrinterStateTransitionPlan({
        transitionCommandId: command.transitionCommandId,
        printerId: printer.id,
        sourcePrinterState: sourceState,
        sourceComponentInstallations: sourceComponents,
        componentDecisions: command.componentDecisions.map(
          ({ componentInstallationId, action }) => ({
            type: action,
            sourceComponentInstallationId: componentInstallationId,
          })
        ),
        addedComponents: [],
        sourceClaimCarryDecisions: sourceClaims,
        createdAt: this.#now(),
        createPrinterStateId: this.#createPrinterStateId,
        createComponentInstallationId: this.#createComponentInstallationId,
        createComponentInstanceId: this.#createComponentInstanceId,
        createClaimId: this.#createClaimId,
      });
    } catch (error) {
      throw new PrinterStateLifecycleApplicationError("transition_plan_invalid", { cause: error });
    }
    try {
      const result = await this.#lifecycle.createOnce(plan);
      return this.#projectResult(
        result.status,
        printer.id,
        sourceState.id,
        result.targetPrinterState.id
      );
    } catch (error) {
      if (error instanceof StalePrinterStateTransitionSourceError) {
        throw new PrinterStateLifecycleApplicationError("stale_transition_context");
      }
      if (error instanceof PrinterStateTransitionCommandConflictError) {
        throw new PrinterStateLifecycleApplicationError("command_conflict");
      }
      throw new PrinterStateLifecycleApplicationError("transition_persistence_failed", {
        cause: error,
      });
    }
  }

  async #authorizePrinter(printerId: string): Promise<Printer> {
    const workspace: Workspace | undefined = await this.#activeWorkspace.getActiveWorkspace();
    if (!workspace) throw new NoActiveWorkspaceError();
    const printer = await this.#printers.findById(printerId);
    if (!printer || printer.workspaceId !== workspace.id) throw new PrinterNotFoundError(printerId);
    return printer;
  }

  async #requireWorkingStateId(printerId: string): Promise<string> {
    const selected = await this.#selection.getSelectedStateId(printerId);
    if (!selected) throw new PrinterStateLifecycleApplicationError("missing_working_state");
    return selected;
  }

  async #loadWorkingState(printer: Printer): Promise<PrinterState> {
    const id = await this.#requireWorkingStateId(printer.id);
    const state = await this.#states.findById(id);
    if (!state || state.printerId !== printer.id) {
      throw new PrinterStateLifecycleApplicationError("missing_working_state");
    }
    return state;
  }

  #validateComponentDecisions(
    command: CreatePrinterStateTransitionCommand,
    sourceIds: readonly string[]
  ): void {
    const submitted = new Set(
      command.componentDecisions.map(({ componentInstallationId }) => componentInstallationId)
    );
    if (submitted.size !== sourceIds.length || sourceIds.some((id) => !submitted.has(id))) {
      throw new PrinterStateLifecycleApplicationError("invalid_component_decisions");
    }
  }

  #projectResult(
    status: "created" | "already_completed",
    printerId: string,
    sourcePrinterStateId: string,
    targetPrinterStateId: string
  ): PrinterStateTransitionResult {
    return Object.freeze({ status, printerId, sourcePrinterStateId, targetPrinterStateId });
  }
}
