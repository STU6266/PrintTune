import type {
  PrinterKnowledgeDefinitionReference,
  PrinterKnowledgeIdentity,
} from "@printtune/contracts";

import { isStrictIsoUtcTimestamp } from "./timestamp-validation.js";

interface CreatePrinterKnowledgeIdentityBaseInput {
  readonly id: string;
  readonly printerId: string;
  readonly selectedAt: string;
}

export type CreatePrinterKnowledgeIdentityInput =
  | (CreatePrinterKnowledgeIdentityBaseInput & {
      readonly kind: "known";
      readonly definitionRef: PrinterKnowledgeDefinitionReference;
      readonly manufacturerDisplayName: string;
      readonly seriesDisplayName: string;
      readonly modelDisplayName?: string;
    })
  | (CreatePrinterKnowledgeIdentityBaseInput & {
      readonly kind: "unclassified";
    });

export class InvalidPrinterKnowledgeIdentityIdError extends Error {
  override readonly name = "InvalidPrinterKnowledgeIdentityIdError";
  constructor() {
    super("PrinterKnowledgeIdentity ID must be a non-empty trimmed string");
  }
}

export class InvalidPrinterKnowledgeIdentityPrinterIdError extends Error {
  override readonly name = "InvalidPrinterKnowledgeIdentityPrinterIdError";
  constructor() {
    super("PrinterKnowledgeIdentity Printer ID must be a non-empty trimmed string");
  }
}

export class InvalidPrinterKnowledgeIdentityKindError extends Error {
  override readonly name = "InvalidPrinterKnowledgeIdentityKindError";
  constructor() {
    super("PrinterKnowledgeIdentity kind must be known or unclassified");
  }
}

export class InvalidPrinterKnowledgeDefinitionReferenceError extends Error {
  override readonly name = "InvalidPrinterKnowledgeDefinitionReferenceError";
  constructor(readonly field: keyof PrinterKnowledgeDefinitionReference | "definitionRef") {
    super(`Printer knowledge definition reference ${field} is invalid`);
  }
}

export class InvalidPrinterKnowledgeDisplaySnapshotError extends Error {
  override readonly name = "InvalidPrinterKnowledgeDisplaySnapshotError";
  constructor(
    readonly field: "manufacturerDisplayName" | "seriesDisplayName" | "modelDisplayName"
  ) {
    super(`Printer knowledge display snapshot ${field} must be a non-empty trimmed string`);
  }
}

export class InvalidPrinterKnowledgeModelPairingError extends Error {
  override readonly name = "InvalidPrinterKnowledgeModelPairingError";
  constructor() {
    super(
      "Printer knowledge model ID and display name must either both be present or both be absent"
    );
  }
}

export class InvalidPrinterKnowledgeIdentityTimestampError extends Error {
  override readonly name = "InvalidPrinterKnowledgeIdentityTimestampError";
  constructor() {
    super("PrinterKnowledgeIdentity selectedAt must be an ISO-8601 UTC string");
  }
}

export class InvalidPrinterKnowledgeIdentityShapeError extends Error {
  override readonly name = "InvalidPrinterKnowledgeIdentityShapeError";
  constructor() {
    super("PrinterKnowledgeIdentity contains fields outside its approved variant");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function validateId(value: unknown, error: Error): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) throw error;
  return value;
}

function validateDisplayName(
  value: unknown,
  field: "manufacturerDisplayName" | "seriesDisplayName" | "modelDisplayName"
): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new InvalidPrinterKnowledgeDisplaySnapshotError(field);
  }
  return value;
}

function validateSelectedAt(value: unknown): string {
  if (!isStrictIsoUtcTimestamp(value)) throw new InvalidPrinterKnowledgeIdentityTimestampError();
  return value;
}

function copyDefinitionReference(value: unknown): PrinterKnowledgeDefinitionReference {
  if (!isRecord(value)) {
    throw new InvalidPrinterKnowledgeDefinitionReferenceError("definitionRef");
  }
  const hasModel = Object.prototype.hasOwnProperty.call(value, "modelDefinitionId");
  const keys = ["packageId", "packageVersion", "seriesDefinitionId"];
  if (!hasExactKeys(value, hasModel ? [...keys, "modelDefinitionId"] : keys)) {
    throw new InvalidPrinterKnowledgeDefinitionReferenceError("definitionRef");
  }
  const read = (field: keyof PrinterKnowledgeDefinitionReference): string =>
    validateId(value[field], new InvalidPrinterKnowledgeDefinitionReferenceError(field));

  return Object.freeze({
    packageId: read("packageId"),
    packageVersion: read("packageVersion"),
    seriesDefinitionId: read("seriesDefinitionId"),
    ...(hasModel ? { modelDefinitionId: read("modelDefinitionId") } : {}),
  });
}

export function createPrinterKnowledgeIdentity(
  input: CreatePrinterKnowledgeIdentityInput
): PrinterKnowledgeIdentity {
  if (!isRecord(input) || (input.kind !== "known" && input.kind !== "unclassified")) {
    throw new InvalidPrinterKnowledgeIdentityKindError();
  }
  const base = {
    id: validateId(input.id, new InvalidPrinterKnowledgeIdentityIdError()),
    printerId: validateId(input.printerId, new InvalidPrinterKnowledgeIdentityPrinterIdError()),
    selectedAt: validateSelectedAt(input.selectedAt),
  };

  if (input.kind === "unclassified") {
    if (!hasExactKeys(input, ["id", "printerId", "kind", "selectedAt"])) {
      throw new InvalidPrinterKnowledgeIdentityShapeError();
    }
    return Object.freeze({ ...base, kind: "unclassified" });
  }

  const hasModelDisplayName = Object.prototype.hasOwnProperty.call(input, "modelDisplayName");
  const knownKeys = [
    "id",
    "printerId",
    "kind",
    "definitionRef",
    "manufacturerDisplayName",
    "seriesDisplayName",
    "selectedAt",
  ];
  if (!hasExactKeys(input, hasModelDisplayName ? [...knownKeys, "modelDisplayName"] : knownKeys)) {
    throw new InvalidPrinterKnowledgeIdentityShapeError();
  }

  const definitionRef = copyDefinitionReference(input.definitionRef);
  const hasModelDefinitionId = definitionRef.modelDefinitionId !== undefined;
  if (hasModelDefinitionId !== hasModelDisplayName) {
    throw new InvalidPrinterKnowledgeModelPairingError();
  }

  return Object.freeze({
    ...base,
    kind: "known",
    definitionRef,
    manufacturerDisplayName: validateDisplayName(
      input.manufacturerDisplayName,
      "manufacturerDisplayName"
    ),
    seriesDisplayName: validateDisplayName(input.seriesDisplayName, "seriesDisplayName"),
    ...(hasModelDisplayName
      ? { modelDisplayName: validateDisplayName(input.modelDisplayName, "modelDisplayName") }
      : {}),
  });
}
