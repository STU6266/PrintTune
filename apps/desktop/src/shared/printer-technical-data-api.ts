import type {
  CanonicalUnit,
  ResolvedFieldReasonCode,
  ResolvedFieldStatus,
} from "@printtune/contracts";

export const PRINTER_TECHNICAL_FIELDS_READ_CHANNEL = "printer:technical-fields:read" as const;
export const PRINTER_MANUAL_CLAIM_CREATE_CHANNEL = "printer:manual-claim:create" as const;

export const MANUAL_TECHNICAL_FIELD_KEYS = [
  "nozzleDiameter",
  "extruderType",
  "hotendMaxTemperature",
] as const;
export type ManualTechnicalFieldKey = (typeof MANUAL_TECHNICAL_FIELD_KEYS)[number];
export type ManualTechnicalFieldValue = string | number;

export interface ReadTechnicalFieldsRequest {
  readonly printerId: string;
}

export interface AddManualTechnicalClaimRequest {
  readonly printerId: string;
  readonly field: ManualTechnicalFieldKey;
  readonly value: ManualTechnicalFieldValue;
  readonly confirmation: "confirmed" | "uncertain";
}

export interface TechnicalFieldSummary {
  readonly field: ManualTechnicalFieldKey;
  readonly status: ResolvedFieldStatus;
  readonly reasonCode: ResolvedFieldReasonCode;
  readonly value?: string | number | boolean;
  readonly unit?: CanonicalUnit;
}

export interface PrinterTechnicalDataApi {
  readPrinterTechnicalFields(printerId: string): Promise<readonly TechnicalFieldSummary[]>;
  addManualPrinterTechnicalClaim(
    input: AddManualTechnicalClaimRequest
  ): Promise<readonly TechnicalFieldSummary[]>;
}

type TechnicalDataChannel =
  typeof PRINTER_TECHNICAL_FIELDS_READ_CHANNEL | typeof PRINTER_MANUAL_CLAIM_CREATE_CHANNEL;
type TechnicalDataInvoke = (channel: TechnicalDataChannel, payload: unknown) => Promise<unknown>;

const STATUS = new Set<ResolvedFieldStatus>(["resolved", "missing", "conflict", "blocked"]);
const REASON = new Set<ResolvedFieldReasonCode>([
  "single_claim",
  "claims_agree",
  "stronger_evidence",
  "newer_same_source",
  "field_policy_selected",
  "safety_conservative_bound",
  "safety_policy_blocked",
  "no_usable_claims",
  "insufficient_confirmation",
  "unresolved_conflict",
  "incompatible_claim_representations",
  "invalid_claim_evidence",
  "unknown_field_definition",
]);
const UNIT = new Set<CanonicalUnit>(["mm", "mm/s", "mm/s2", "degC", "mm3/s", "ratio"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isField(value: unknown): value is ManualTechnicalFieldKey {
  return MANUAL_TECHNICAL_FIELD_KEYS.includes(value as ManualTechnicalFieldKey);
}

export function assertReadTechnicalFieldsRequest(value: unknown): ReadTechnicalFieldsRequest {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isId(value.printerId)) {
    throw new TypeError("Invalid technical fields request");
  }
  return Object.freeze({ printerId: value.printerId });
}

export function assertAddManualTechnicalClaimRequest(
  value: unknown
): AddManualTechnicalClaimRequest {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 4 ||
    !isId(value.printerId) ||
    !isField(value.field) ||
    (value.field === "extruderType"
      ? typeof value.value !== "string"
      : typeof value.value !== "number" || !Number.isFinite(value.value)) ||
    (value.confirmation !== "confirmed" && value.confirmation !== "uncertain")
  ) {
    throw new TypeError("Invalid manual technical Claim request");
  }
  return Object.freeze({
    printerId: value.printerId,
    field: value.field,
    value: value.value as ManualTechnicalFieldValue,
    confirmation: value.confirmation,
  });
}

export function assertTechnicalFieldSummaries(value: unknown): readonly TechnicalFieldSummary[] {
  if (!Array.isArray(value) || value.length !== MANUAL_TECHNICAL_FIELD_KEYS.length) {
    throw new TypeError("Invalid technical field summary response");
  }
  const fields = value.map((item): TechnicalFieldSummary => {
    if (
      !isRecord(item) ||
      !isField(item.field) ||
      !STATUS.has(item.status as ResolvedFieldStatus) ||
      !REASON.has(item.reasonCode as ResolvedFieldReasonCode)
    ) {
      throw new TypeError("Invalid technical field summary response");
    }
    const allowedKeys =
      item.status === "resolved"
        ? ["field", "status", "reasonCode", "value", "unit"]
        : ["field", "status", "reasonCode", "unit"];
    if (
      Object.keys(item).some((key) => !allowedKeys.includes(key)) ||
      (item.status === "resolved" &&
        !["string", "number", "boolean"].includes(typeof item.value)) ||
      (item.status !== "resolved" && "value" in item) ||
      (item.unit !== undefined && !UNIT.has(item.unit as CanonicalUnit))
    ) {
      throw new TypeError("Invalid technical field summary response");
    }
    const status = item.status as ResolvedFieldStatus;
    return Object.freeze({
      field: item.field,
      status,
      reasonCode: item.reasonCode as ResolvedFieldReasonCode,
      ...(status === "resolved" ? { value: item.value as string | number | boolean } : {}),
      ...(item.unit === undefined ? {} : { unit: item.unit as CanonicalUnit }),
    });
  });
  if (new Set(fields.map(({ field }) => field)).size !== MANUAL_TECHNICAL_FIELD_KEYS.length) {
    throw new TypeError("Invalid technical field summary response");
  }
  return Object.freeze(fields);
}

export function createPrinterTechnicalDataApi(
  invoke: TechnicalDataInvoke
): PrinterTechnicalDataApi {
  return Object.freeze({
    async readPrinterTechnicalFields(printerId: string) {
      const request = assertReadTechnicalFieldsRequest({ printerId });
      return assertTechnicalFieldSummaries(
        await invoke(PRINTER_TECHNICAL_FIELDS_READ_CHANNEL, request)
      );
    },
    async addManualPrinterTechnicalClaim(input: AddManualTechnicalClaimRequest) {
      const request = assertAddManualTechnicalClaimRequest(input);
      return assertTechnicalFieldSummaries(
        await invoke(PRINTER_MANUAL_CLAIM_CREATE_CHANNEL, request)
      );
    },
  });
}
