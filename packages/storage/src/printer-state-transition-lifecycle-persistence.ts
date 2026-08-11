import type { PrinterState, PrinterStateTransitionPlan } from "@printtune/contracts";

import {
  InMemoryComponentInstallationRepository,
  deleteComponentInstallationForRollback,
} from "./in-memory-component-installation-repository.js";
import {
  InMemoryFieldClaimRepository,
  deleteFieldClaimForRollback,
} from "./in-memory-field-claim-repository.js";
import {
  InMemoryPrinterStateRepository,
  deletePrinterStateForRollback,
} from "./in-memory-printer-state-repository.js";
import { InMemoryPrinterStateSelectionPersistence } from "./printer-state-selection-persistence.js";

export interface CompletedPrinterStateTransitionCommand {
  readonly commandId: string;
  readonly printerId: string;
  readonly sourcePrinterStateId: string;
  readonly targetPrinterStateId: string;
}

export type PrinterStateTransitionLifecycleResult =
  | { readonly status: "created"; readonly targetPrinterState: PrinterState }
  | { readonly status: "already_completed"; readonly targetPrinterState: PrinterState };

export interface CompletedPrinterStateTransitionCommandRepository {
  findCompletedByCommandId(
    commandId: string
  ): Promise<CompletedPrinterStateTransitionCommand | undefined>;
}

export interface PrinterStateTransitionLifecyclePersistence extends CompletedPrinterStateTransitionCommandRepository {
  createOnce(plan: PrinterStateTransitionPlan): Promise<PrinterStateTransitionLifecycleResult>;
}

export class PrinterStateTransitionCommandConflictError extends Error {
  override readonly name = "PrinterStateTransitionCommandConflictError";
}

export class StalePrinterStateTransitionSourceError extends Error {
  override readonly name = "StalePrinterStateTransitionSourceError";
}

export class InvalidPrinterStateTransitionPlanError extends Error {
  override readonly name = "InvalidPrinterStateTransitionPlanError";
}

function commandFromPlan(plan: PrinterStateTransitionPlan): CompletedPrinterStateTransitionCommand {
  return Object.freeze({
    commandId: plan.transitionCommandId,
    printerId: plan.printerId,
    sourcePrinterStateId: plan.sourcePrinterStateId,
    targetPrinterStateId: plan.targetPrinterState.id,
  });
}

function validatePlan(plan: PrinterStateTransitionPlan): void {
  if (
    plan.targetPrinterState.printerId !== plan.printerId ||
    plan.targetPrinterState.parentPrinterStateId !== plan.sourcePrinterStateId ||
    plan.targetComponentInstallations.some(
      (component) => component.printerStateId !== plan.targetPrinterState.id
    ) ||
    plan.carriedClaims.some(
      (claim) =>
        claim.target.type !== "printer_state" ||
        claim.target.printerStateId !== plan.targetPrinterState.id ||
        claim.provenance.sourceType !== "state_transition" ||
        claim.provenance.sourceRef?.type !== "state_transition" ||
        claim.provenance.sourceRef.transitionCommandId !== plan.transitionCommandId
    )
  ) {
    throw new InvalidPrinterStateTransitionPlanError();
  }
}

export class InMemoryPrinterStateTransitionLifecyclePersistence implements PrinterStateTransitionLifecyclePersistence {
  readonly #states: InMemoryPrinterStateRepository;
  readonly #components: InMemoryComponentInstallationRepository;
  readonly #claims: InMemoryFieldClaimRepository;
  readonly #selection: InMemoryPrinterStateSelectionPersistence;
  readonly #commands = new Map<string, CompletedPrinterStateTransitionCommand>();

  constructor(
    states: InMemoryPrinterStateRepository,
    components: InMemoryComponentInstallationRepository,
    claims: InMemoryFieldClaimRepository,
    selection: InMemoryPrinterStateSelectionPersistence
  ) {
    this.#states = states;
    this.#components = components;
    this.#claims = claims;
    this.#selection = selection;
  }

  async findCompletedByCommandId(
    commandId: string
  ): Promise<CompletedPrinterStateTransitionCommand | undefined> {
    const command = this.#commands.get(commandId);
    return command ? Object.freeze({ ...command }) : undefined;
  }

  async createOnce(
    plan: PrinterStateTransitionPlan
  ): Promise<PrinterStateTransitionLifecycleResult> {
    const existing = this.#commands.get(plan.transitionCommandId);
    if (existing) {
      if (
        existing.printerId !== plan.printerId ||
        existing.sourcePrinterStateId !== plan.sourcePrinterStateId
      ) {
        throw new PrinterStateTransitionCommandConflictError();
      }
      const target = await this.#states.findById(existing.targetPrinterStateId);
      if (!target) throw new InvalidPrinterStateTransitionPlanError();
      return Object.freeze({ status: "already_completed", targetPrinterState: target });
    }
    validatePlan(plan);
    if ((await this.#selection.getSelectedStateId(plan.printerId)) !== plan.sourcePrinterStateId) {
      throw new StalePrinterStateTransitionSourceError();
    }
    for (const claim of plan.carriedClaims) {
      const reference = claim.provenance.sourceRef;
      if (
        reference?.type !== "state_transition" ||
        (await this.#claims.findById(reference.sourceClaimId)) === undefined
      ) {
        throw new InvalidPrinterStateTransitionPlanError();
      }
    }
    const createdComponents: string[] = [];
    const createdClaims: string[] = [];
    try {
      await this.#states.create(plan.targetPrinterState);
      for (const component of plan.targetComponentInstallations) {
        await this.#components.create(component);
        createdComponents.push(component.id);
      }
      for (const claim of plan.carriedClaims) {
        this.#claims.createForTransition(claim);
        createdClaims.push(claim.id);
      }
      const command = commandFromPlan(plan);
      this.#commands.set(command.commandId, command);
      await this.#selection.setSelectedState(plan.printerId, plan.targetPrinterState.id);
      return Object.freeze({ status: "created", targetPrinterState: plan.targetPrinterState });
    } catch (error) {
      this.#commands.delete(plan.transitionCommandId);
      for (const id of createdClaims) this.#claims[deleteFieldClaimForRollback](id);
      for (const id of createdComponents)
        this.#components[deleteComponentInstallationForRollback](id);
      this.#states[deletePrinterStateForRollback](plan.targetPrinterState.id);
      throw error;
    }
  }
}
