import { randomUUID } from "node:crypto";

import type {
  CanonicalUnit,
  FieldClaimValue,
  ResolvedFieldReasonCode,
  ResolvedFieldStatus,
} from "@printtune/contracts";
import { createFieldClaim } from "@printtune/core";
import type { FieldClaimRepository } from "@printtune/storage";

import type {
  ManualTechnicalFieldKey,
  ManualTechnicalFieldValue,
  TechnicalFieldSummary,
} from "../shared/printer-technical-data-api";
import type { FieldResolutionService } from "./field-resolution-service";
import type { PrinterFlowApplicationService } from "./printer-flow-application-service";

interface ManualFieldDefinition {
  readonly fieldPath: string;
  readonly valueType: "number" | "string";
  readonly unit?: CanonicalUnit;
}

export const SUPPORTED_MANUAL_TECHNICAL_FIELDS = Object.freeze({
  nozzleDiameter: {
    fieldPath: "printer.nozzle.diameter",
    valueType: "number",
    unit: "mm",
  },
  extruderType: {
    fieldPath: "printer.extruder.type",
    valueType: "string",
  },
  hotendMaxTemperature: {
    fieldPath: "printer.hotend.max-temperature",
    valueType: "number",
    unit: "degC",
  },
} as const satisfies Record<ManualTechnicalFieldKey, ManualFieldDefinition>);

export class UnsupportedManualTechnicalFieldError extends Error {
  override readonly name = "UnsupportedManualTechnicalFieldError";
}

export class InvalidManualTechnicalValueError extends Error {
  override readonly name = "InvalidManualTechnicalValueError";
}

interface PrinterTechnicalDataDependencies {
  readonly createClaimId?: () => string;
  readonly now?: () => string;
}

export interface AddManualTechnicalClaimInput {
  readonly printerId: string;
  readonly field: ManualTechnicalFieldKey;
  readonly value: ManualTechnicalFieldValue;
  readonly confirmation: "confirmed" | "uncertain";
}

export class PrinterTechnicalDataService {
  readonly #printerFlow: PrinterFlowApplicationService;
  readonly #claims: FieldClaimRepository;
  readonly #resolution: FieldResolutionService;
  readonly #createClaimId: () => string;
  readonly #now: () => string;

  constructor(
    printerFlow: PrinterFlowApplicationService,
    claims: FieldClaimRepository,
    resolution: FieldResolutionService,
    dependencies: PrinterTechnicalDataDependencies = {}
  ) {
    this.#printerFlow = printerFlow;
    this.#claims = claims;
    this.#resolution = resolution;
    this.#createClaimId = dependencies.createClaimId ?? randomUUID;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async readTechnicalFields(printerId: string): Promise<readonly TechnicalFieldSummary[]> {
    const { initialState } = await this.#printerFlow.getPrinterDetail(printerId);
    const target = { type: "printer_state" as const, printerStateId: initialState.id };

    return Promise.all(
      (Object.keys(SUPPORTED_MANUAL_TECHNICAL_FIELDS) as ManualTechnicalFieldKey[]).map(
        async (key) => {
          const definition: ManualFieldDefinition = SUPPORTED_MANUAL_TECHNICAL_FIELDS[key];
          const resolved = await this.#resolution.resolve({
            target,
            fieldPath: definition.fieldPath,
          });
          return summaryFromResolution(key, definition.unit, resolved);
        }
      )
    );
  }

  async addManualClaim(
    input: AddManualTechnicalClaimInput
  ): Promise<readonly TechnicalFieldSummary[]> {
    const definition: ManualFieldDefinition | undefined =
      SUPPORTED_MANUAL_TECHNICAL_FIELDS[input.field];
    if (!definition) throw new UnsupportedManualTechnicalFieldError();
    if (input.confirmation !== "confirmed" && input.confirmation !== "uncertain") {
      throw new InvalidManualTechnicalValueError();
    }
    const { initialState } = await this.#printerFlow.getPrinterDetail(input.printerId);
    const value = validateValue(definition, input.value);
    const confirmed = input.confirmation === "confirmed";

    const claim = createFieldClaim({
      id: this.#createClaimId(),
      target: { type: "printer_state", printerStateId: initialState.id },
      fieldPath: definition.fieldPath,
      value,
      ...(definition.unit === undefined ? {} : { unit: definition.unit }),
      provenance: { sourceType: confirmed ? "user_confirmed" : "user_entered" },
      trust: confirmed ? "user_confirmed" : "user_entered",
      timestamp: this.#now(),
    });
    await this.#claims.create(claim);
    return this.readTechnicalFields(input.printerId);
  }
}

function validateValue(
  definition: ManualFieldDefinition,
  value: ManualTechnicalFieldValue
): FieldClaimValue {
  if (definition.valueType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new InvalidManualTechnicalValueError();
    }
    return { type: "number", value };
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidManualTechnicalValueError();
  }
  return { type: "string", value: value.trim() };
}

function summaryFromResolution(
  key: ManualTechnicalFieldKey,
  unit: CanonicalUnit | undefined,
  resolution: {
    readonly status: ResolvedFieldStatus;
    readonly reasonCode: ResolvedFieldReasonCode;
    readonly value?: FieldClaimValue;
  }
): TechnicalFieldSummary {
  return Object.freeze({
    field: key,
    status: resolution.status,
    reasonCode: resolution.reasonCode,
    ...(resolution.status === "resolved" && resolution.value
      ? { value: resolution.value.value }
      : {}),
    ...(unit === undefined ? {} : { unit }),
  });
}
