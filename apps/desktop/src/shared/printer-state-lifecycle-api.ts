import type { CanonicalUnit, FieldClaimValue } from "@printtune/contracts";

export const PRINTER_STATE_OVERVIEW_GET_CHANNEL = "printer-state:overview:get" as const;
export const PRINTER_STATE_TRANSITION_PREPARATION_GET_CHANNEL =
  "printer-state:transition-preparation:get" as const;
export const PRINTER_STATE_TRANSITION_CREATE_CHANNEL = "printer-state:transition:create" as const;

export interface PrinterStateLifecycleRequest {
  readonly printerId: string;
}

export interface PrinterStateOverviewItem {
  readonly printerStateId: string;
  readonly parentPrinterStateId?: string;
  readonly createdAt: string;
  readonly isWorking: boolean;
}

export interface PrinterStateOverview {
  readonly printerId: string;
  readonly workingPrinterStateId: string;
  readonly states: readonly PrinterStateOverviewItem[];
}

export interface TransitionComponentChoice {
  readonly componentInstallationId: string;
  readonly role: string;
  readonly kind: string;
  readonly displayName: string;
}

export type TransitionClaimDisposition =
  "auto_carry" | "confirmation_required" | "reconfirmation_required" | "not_carryable";

export interface TransitionClaimChoice {
  readonly sourceClaimId: string;
  readonly fieldPath: string;
  readonly value: FieldClaimValue;
  readonly unit?: CanonicalUnit;
  readonly disposition: TransitionClaimDisposition;
  readonly reason?: string;
}

export interface TransitionReconfirmationField {
  readonly fieldPath: string;
  readonly value: FieldClaimValue;
  readonly unit?: CanonicalUnit;
}

export interface PrinterStateTransitionPreparation {
  readonly printerId: string;
  readonly sourcePrinterStateId: string;
  readonly components: readonly TransitionComponentChoice[];
  readonly claimCarryChoices: readonly TransitionClaimChoice[];
  readonly reconfirmationFields: readonly TransitionReconfirmationField[];
}

export interface PrinterStateComponentDecisionCommand {
  readonly componentInstallationId: string;
  readonly action: "retain" | "remove";
}

export interface PrinterStateClaimCarryDecisionCommand {
  readonly sourceClaimId: string;
  readonly applicabilityConfirmed: boolean;
}

export interface CreatePrinterStateTransitionCommand {
  /**
   * Opaque renderer-owned idempotency key. Reuse it only for an uncertain retry of the exact same
   * transition intent; changed intent requires a new ID. Transport never replaces or retries it.
   */
  readonly transitionCommandId: string;
  readonly printerId: string;
  readonly expectedSourcePrinterStateId: string;
  readonly componentDecisions: readonly PrinterStateComponentDecisionCommand[];
  readonly claimCarryDecisions: readonly PrinterStateClaimCarryDecisionCommand[];
}

export interface PrinterStateTransitionResult {
  readonly status: "created" | "already_completed";
  readonly printerId: string;
  readonly sourcePrinterStateId: string;
  readonly targetPrinterStateId: string;
}

export type PrinterStateLifecycleApiErrorCode =
  | "invalid_request"
  | "no_active_workspace"
  | "printer_unavailable"
  | "missing_working_state"
  | "stale_transition_context"
  | "command_conflict"
  | "invalid_component_decisions"
  | "invalid_claim_decisions"
  | "transition_unavailable"
  | "read_failed"
  | "internal_failure";

export type PrinterStateLifecycleTransportResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PrinterStateLifecycleApiErrorCode };

export class PrinterStateLifecycleApiError extends Error {
  override readonly name = "PrinterStateLifecycleApiError";
  constructor(readonly code: PrinterStateLifecycleApiErrorCode) {
    super(`PrinterState lifecycle request failed: ${code}`);
  }
}

export interface PrinterStateLifecycleApi {
  getPrinterStateOverview(request: PrinterStateLifecycleRequest): Promise<PrinterStateOverview>;
  getPrinterStateTransitionPreparation(
    request: PrinterStateLifecycleRequest
  ): Promise<PrinterStateTransitionPreparation>;
  createPrinterStateTransition(
    command: CreatePrinterStateTransitionCommand
  ): Promise<PrinterStateTransitionResult>;
}

type PrinterStateLifecycleChannel =
  | typeof PRINTER_STATE_OVERVIEW_GET_CHANNEL
  | typeof PRINTER_STATE_TRANSITION_PREPARATION_GET_CHANNEL
  | typeof PRINTER_STATE_TRANSITION_CREATE_CHANNEL;
type PrinterStateLifecycleInvoke = (
  channel: PrinterStateLifecycleChannel,
  payload: unknown
) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

const ISO_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const UNITS: readonly CanonicalUnit[] = ["mm", "mm/s", "mm/s2", "degC", "mm3/s", "ratio"];

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const milliseconds = Date.parse(value);
  const normalized = value.includes(".")
    ? value.replace(/\.(\d{1,3})Z$/, (_, fraction: string) => `.${fraction.padEnd(3, "0")}Z`)
    : value.replace("Z", ".000Z");
  return !Number.isNaN(milliseconds) && new Date(milliseconds).toISOString() === normalized;
}

function assertValue(value: unknown): FieldClaimValue {
  if (!isRecord(value) || !hasExactKeys(value, ["type", "value"])) {
    throw new TypeError("Invalid transition Claim value");
  }
  if (value.type === "string" && typeof value.value === "string")
    return Object.freeze({ type: "string", value: value.value });
  if (value.type === "number" && typeof value.value === "number" && Number.isFinite(value.value))
    return Object.freeze({ type: "number", value: value.value });
  if (value.type === "boolean" && typeof value.value === "boolean")
    return Object.freeze({ type: "boolean", value: value.value });
  throw new TypeError("Invalid transition Claim value");
}

function assertUnit(value: unknown): CanonicalUnit | undefined {
  if (value === undefined) return undefined;
  if (!UNITS.includes(value as CanonicalUnit)) throw new TypeError("Invalid transition Claim unit");
  return value as CanonicalUnit;
}

export function assertPrinterStateLifecycleRequest(value: unknown): PrinterStateLifecycleRequest {
  if (!isRecord(value) || !hasExactKeys(value, ["printerId"]) || !isId(value.printerId)) {
    throw new TypeError("Invalid PrinterState lifecycle request");
  }
  return Object.freeze({ printerId: value.printerId });
}

export function assertCreatePrinterStateTransitionCommand(
  value: unknown
): CreatePrinterStateTransitionCommand {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "transitionCommandId",
      "printerId",
      "expectedSourcePrinterStateId",
      "componentDecisions",
      "claimCarryDecisions",
    ]) ||
    !isId(value.transitionCommandId) ||
    !isId(value.printerId) ||
    !isId(value.expectedSourcePrinterStateId) ||
    !Array.isArray(value.componentDecisions) ||
    !Array.isArray(value.claimCarryDecisions)
  ) {
    throw new TypeError("Invalid PrinterState transition command");
  }

  const componentIds = new Set<string>();
  const componentDecisions = value.componentDecisions.map((decision) => {
    if (
      !isRecord(decision) ||
      !hasExactKeys(decision, ["componentInstallationId", "action"]) ||
      !isId(decision.componentInstallationId) ||
      (decision.action !== "retain" && decision.action !== "remove") ||
      componentIds.has(decision.componentInstallationId)
    ) {
      throw new TypeError("Invalid PrinterState component decision");
    }
    componentIds.add(decision.componentInstallationId);
    return Object.freeze({
      componentInstallationId: decision.componentInstallationId,
      action: decision.action,
    });
  });

  const claimIds = new Set<string>();
  const claimCarryDecisions = value.claimCarryDecisions.map((decision) => {
    if (
      !isRecord(decision) ||
      !hasExactKeys(decision, ["sourceClaimId", "applicabilityConfirmed"]) ||
      !isId(decision.sourceClaimId) ||
      typeof decision.applicabilityConfirmed !== "boolean" ||
      claimIds.has(decision.sourceClaimId)
    ) {
      throw new TypeError("Invalid PrinterState Claim carry decision");
    }
    claimIds.add(decision.sourceClaimId);
    return Object.freeze({
      sourceClaimId: decision.sourceClaimId,
      applicabilityConfirmed: decision.applicabilityConfirmed,
    });
  });

  return Object.freeze({
    transitionCommandId: value.transitionCommandId,
    printerId: value.printerId,
    expectedSourcePrinterStateId: value.expectedSourcePrinterStateId,
    componentDecisions: Object.freeze(componentDecisions),
    claimCarryDecisions: Object.freeze(claimCarryDecisions),
  });
}

export function assertPrinterStateOverview(value: unknown): PrinterStateOverview {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["printerId", "workingPrinterStateId", "states"]) ||
    !isId(value.printerId) ||
    !isId(value.workingPrinterStateId) ||
    !Array.isArray(value.states)
  ) {
    throw new TypeError("Invalid PrinterState overview response");
  }
  const states = value.states.map((state) => {
    if (!isRecord(state)) throw new TypeError("Invalid PrinterState overview item");
    const expected =
      state.parentPrinterStateId === undefined
        ? ["printerStateId", "createdAt", "isWorking"]
        : ["printerStateId", "parentPrinterStateId", "createdAt", "isWorking"];
    if (
      !hasExactKeys(state, expected) ||
      !isId(state.printerStateId) ||
      (state.parentPrinterStateId !== undefined && !isId(state.parentPrinterStateId)) ||
      !isTimestamp(state.createdAt) ||
      typeof state.isWorking !== "boolean"
    )
      throw new TypeError("Invalid PrinterState overview item");
    return Object.freeze({
      printerStateId: state.printerStateId,
      ...(state.parentPrinterStateId === undefined
        ? {}
        : { parentPrinterStateId: state.parentPrinterStateId }),
      createdAt: state.createdAt,
      isWorking: state.isWorking,
    });
  });
  const workingStates = states.filter(({ isWorking }) => isWorking);
  if (
    workingStates.length !== 1 ||
    workingStates[0]?.printerStateId !== value.workingPrinterStateId
  ) {
    throw new TypeError("Invalid PrinterState working projection");
  }
  return Object.freeze({
    printerId: value.printerId,
    workingPrinterStateId: value.workingPrinterStateId,
    states: Object.freeze(states),
  });
}

export function assertPrinterStateTransitionPreparation(
  value: unknown
): PrinterStateTransitionPreparation {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "printerId",
      "sourcePrinterStateId",
      "components",
      "claimCarryChoices",
      "reconfirmationFields",
    ]) ||
    !isId(value.printerId) ||
    !isId(value.sourcePrinterStateId) ||
    !Array.isArray(value.components) ||
    !Array.isArray(value.claimCarryChoices) ||
    !Array.isArray(value.reconfirmationFields)
  )
    throw new TypeError("Invalid transition preparation response");
  const components = value.components.map((item) => {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ["componentInstallationId", "role", "kind", "displayName"]) ||
      !isId(item.componentInstallationId) ||
      !isId(item.role) ||
      !isId(item.kind) ||
      !isId(item.displayName)
    ) {
      throw new TypeError("Invalid transition component projection");
    }
    return Object.freeze({
      componentInstallationId: item.componentInstallationId,
      role: item.role,
      kind: item.kind,
      displayName: item.displayName,
    });
  });
  const dispositions: readonly TransitionClaimDisposition[] = [
    "auto_carry",
    "confirmation_required",
    "reconfirmation_required",
    "not_carryable",
  ];
  const claimCarryChoices = value.claimCarryChoices.map((item) => {
    if (!isRecord(item)) throw new TypeError("Invalid transition Claim projection");
    const expected =
      item.reason === undefined
        ? ["sourceClaimId", "fieldPath", "value", "disposition"]
        : ["sourceClaimId", "fieldPath", "value", "disposition", "reason"];
    const unitExpected = item.unit === undefined ? expected : [...expected, "unit"];
    if (
      !hasExactKeys(item, unitExpected) ||
      !isId(item.sourceClaimId) ||
      !isId(item.fieldPath) ||
      !dispositions.includes(item.disposition as TransitionClaimDisposition) ||
      (item.reason !== undefined && typeof item.reason !== "string")
    ) {
      throw new TypeError("Invalid transition Claim projection");
    }
    const unit = assertUnit(item.unit);
    return Object.freeze({
      sourceClaimId: item.sourceClaimId,
      fieldPath: item.fieldPath,
      value: assertValue(item.value),
      ...(unit === undefined ? {} : { unit }),
      disposition: item.disposition as TransitionClaimDisposition,
      ...(item.reason === undefined ? {} : { reason: item.reason }),
    });
  });
  const reconfirmationFields = value.reconfirmationFields.map((item) => {
    if (!isRecord(item)) throw new TypeError("Invalid reconfirmation projection");
    const expected =
      item.unit === undefined ? ["fieldPath", "value"] : ["fieldPath", "value", "unit"];
    if (!hasExactKeys(item, expected) || !isId(item.fieldPath))
      throw new TypeError("Invalid reconfirmation projection");
    const unit = assertUnit(item.unit);
    return Object.freeze({
      fieldPath: item.fieldPath,
      value: assertValue(item.value),
      ...(unit === undefined ? {} : { unit }),
    });
  });
  return Object.freeze({
    printerId: value.printerId,
    sourcePrinterStateId: value.sourcePrinterStateId,
    components: Object.freeze(components),
    claimCarryChoices: Object.freeze(claimCarryChoices),
    reconfirmationFields: Object.freeze(reconfirmationFields),
  });
}

export function assertPrinterStateTransitionResult(value: unknown): PrinterStateTransitionResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["status", "printerId", "sourcePrinterStateId", "targetPrinterStateId"]) ||
    (value.status !== "created" && value.status !== "already_completed") ||
    !isId(value.printerId) ||
    !isId(value.sourcePrinterStateId) ||
    !isId(value.targetPrinterStateId)
  ) {
    throw new TypeError("Invalid PrinterState transition response");
  }
  return Object.freeze({
    status: value.status,
    printerId: value.printerId,
    sourcePrinterStateId: value.sourcePrinterStateId,
    targetPrinterStateId: value.targetPrinterStateId,
  });
}

function unwrap<T>(value: unknown, assertResult: (candidate: unknown) => T): T {
  if (!isRecord(value) || (value.ok !== true && value.ok !== false))
    throw new TypeError("Invalid PrinterState lifecycle transport response");
  if (value.ok === false) {
    const codes: readonly PrinterStateLifecycleApiErrorCode[] = [
      "invalid_request",
      "no_active_workspace",
      "printer_unavailable",
      "missing_working_state",
      "stale_transition_context",
      "command_conflict",
      "invalid_component_decisions",
      "invalid_claim_decisions",
      "transition_unavailable",
      "read_failed",
      "internal_failure",
    ];
    if (
      !hasExactKeys(value, ["ok", "error"]) ||
      !codes.includes(value.error as PrinterStateLifecycleApiErrorCode)
    )
      throw new TypeError("Invalid PrinterState lifecycle error response");
    throw new PrinterStateLifecycleApiError(value.error as PrinterStateLifecycleApiErrorCode);
  }
  if (!hasExactKeys(value, ["ok", "value"]))
    throw new TypeError("Invalid PrinterState lifecycle success response");
  return assertResult(value.value);
}

export function createPrinterStateLifecycleApi(
  invoke: PrinterStateLifecycleInvoke
): PrinterStateLifecycleApi {
  return Object.freeze({
    async getPrinterStateOverview(request: PrinterStateLifecycleRequest) {
      const validated = assertPrinterStateLifecycleRequest(request);
      return unwrap(
        await invoke(PRINTER_STATE_OVERVIEW_GET_CHANNEL, validated),
        assertPrinterStateOverview
      );
    },
    async getPrinterStateTransitionPreparation(request: PrinterStateLifecycleRequest) {
      const validated = assertPrinterStateLifecycleRequest(request);
      return unwrap(
        await invoke(PRINTER_STATE_TRANSITION_PREPARATION_GET_CHANNEL, validated),
        assertPrinterStateTransitionPreparation
      );
    },
    async createPrinterStateTransition(command: CreatePrinterStateTransitionCommand) {
      const validated = assertCreatePrinterStateTransitionCommand(command);
      return unwrap(
        await invoke(PRINTER_STATE_TRANSITION_CREATE_CHANNEL, validated),
        assertPrinterStateTransitionResult
      );
    },
  });
}
