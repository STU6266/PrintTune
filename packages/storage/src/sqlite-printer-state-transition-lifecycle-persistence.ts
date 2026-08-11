import type { PrinterStateTransitionPlan } from "@printtune/contracts";

import {
  InvalidPrinterStateTransitionPlanError,
  PrinterStateTransitionCommandConflictError,
  StalePrinterStateTransitionSourceError,
  type CompletedPrinterStateTransitionCommand,
  type PrinterStateTransitionLifecyclePersistence,
  type PrinterStateTransitionLifecycleResult,
} from "./printer-state-transition-lifecycle-persistence.js";
import { SqliteComponentInstallationRepository } from "./sqlite-component-installation-repository.js";
import { insertFieldClaim, prepareFieldClaimInsert } from "./sqlite-field-claim-repository.js";
import { SqlitePrinterStateRepository } from "./sqlite-printer-state-repository.js";
import { SqlitePrinterStateSelectionPersistence } from "./sqlite-printer-state-selection-persistence.js";

type SqliteValue = string | number | null;
interface Statement {
  run(...values: SqliteValue[]): { readonly changes: number | bigint };
  get(...values: string[]): unknown;
  all(...values: string[]): unknown[];
}
interface Connection {
  readonly isTransaction: boolean;
  exec(sql: string): void;
  prepare(sql: string): Statement;
}

function parseCommand(row: unknown): CompletedPrinterStateTransitionCommand {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new InvalidPrinterStateTransitionPlanError();
  }
  const value = row as Record<string, unknown>;
  if (
    typeof value.command_id !== "string" ||
    typeof value.printer_id !== "string" ||
    typeof value.source_printer_state_id !== "string" ||
    typeof value.target_printer_state_id !== "string"
  ) {
    throw new InvalidPrinterStateTransitionPlanError();
  }
  return Object.freeze({
    commandId: value.command_id,
    printerId: value.printer_id,
    sourcePrinterStateId: value.source_printer_state_id,
    targetPrinterStateId: value.target_printer_state_id,
  });
}

export class SqlitePrinterStateTransitionLifecyclePersistence implements PrinterStateTransitionLifecyclePersistence {
  readonly #database: Connection;
  readonly #states: SqlitePrinterStateRepository;
  readonly #components: SqliteComponentInstallationRepository;
  readonly #selection: SqlitePrinterStateSelectionPersistence;
  readonly #findCommand: Statement;
  readonly #insertCommand: Statement;
  readonly #insertClaim: Statement;

  constructor(database: Connection) {
    this.#database = database;
    this.#states = new SqlitePrinterStateRepository(database);
    this.#components = new SqliteComponentInstallationRepository(database);
    this.#selection = new SqlitePrinterStateSelectionPersistence(database);
    this.#findCommand = database.prepare(`
      SELECT command_id, printer_id, source_printer_state_id, target_printer_state_id
      FROM printer_state_transition_commands WHERE command_id = ?
    `);
    this.#insertCommand = database.prepare(`
      INSERT INTO printer_state_transition_commands (
        command_id, printer_id, source_printer_state_id, target_printer_state_id
      ) VALUES (?, ?, ?, ?)
    `);
    this.#insertClaim = prepareFieldClaimInsert(database);
  }

  async findCompletedByCommandId(
    commandId: string
  ): Promise<CompletedPrinterStateTransitionCommand | undefined> {
    const row = this.#findCommand.get(commandId);
    return row === undefined ? undefined : parseCommand(row);
  }

  async createOnce(
    plan: PrinterStateTransitionPlan
  ): Promise<PrinterStateTransitionLifecycleResult> {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const existing = await this.findCompletedByCommandId(plan.transitionCommandId);
      if (existing) {
        if (
          existing.printerId !== plan.printerId ||
          existing.sourcePrinterStateId !== plan.sourcePrinterStateId
        ) {
          throw new PrinterStateTransitionCommandConflictError();
        }
        const target = await this.#states.findById(existing.targetPrinterStateId);
        if (!target) throw new InvalidPrinterStateTransitionPlanError();
        this.#database.exec("COMMIT");
        return Object.freeze({ status: "already_completed", targetPrinterState: target });
      }
      if (
        (await this.#selection.getSelectedStateId(plan.printerId)) !== plan.sourcePrinterStateId
      ) {
        throw new StalePrinterStateTransitionSourceError();
      }
      if (
        plan.targetPrinterState.printerId !== plan.printerId ||
        plan.targetPrinterState.parentPrinterStateId !== plan.sourcePrinterStateId ||
        plan.targetComponentInstallations.some(
          (item) => item.printerStateId !== plan.targetPrinterState.id
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
      await this.#states.create(plan.targetPrinterState);
      this.#insertCommand.run(
        plan.transitionCommandId,
        plan.printerId,
        plan.sourcePrinterStateId,
        plan.targetPrinterState.id
      );
      for (const component of plan.targetComponentInstallations)
        await this.#components.create(component);
      for (const claim of plan.carriedClaims)
        insertFieldClaim(this.#insertClaim, claim, { allowStateTransition: true });
      await this.#selection.setSelectedState(plan.printerId, plan.targetPrinterState.id);
      this.#database.exec("COMMIT");
      return Object.freeze({ status: "created", targetPrinterState: plan.targetPrinterState });
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}
