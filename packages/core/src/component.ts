import type {
  ComponentDefinition,
  ComponentDefinitionReference,
  ComponentInstallation,
} from "@printtune/contracts";

export interface CreateComponentDefinitionInput {
  readonly id: string;
  readonly kind: string;
  readonly displayName: string;
}

export interface CreateComponentInstallationInput {
  readonly id: string;
  readonly printerStateId: string;
  readonly componentInstanceId: string;
  readonly role: string;
  readonly kind: string;
  readonly displayName: string;
  readonly definitionRef?: ComponentDefinitionReference;
}

export class InvalidComponentDefinitionIdError extends Error {
  override readonly name = "InvalidComponentDefinitionIdError";

  constructor() {
    super("ComponentDefinition ID must be a non-empty trimmed string");
  }
}

export class InvalidComponentInstallationIdError extends Error {
  override readonly name = "InvalidComponentInstallationIdError";

  constructor() {
    super("ComponentInstallation ID must be a non-empty trimmed string");
  }
}

export class InvalidComponentPrinterStateIdError extends Error {
  override readonly name = "InvalidComponentPrinterStateIdError";

  constructor() {
    super("ComponentInstallation PrinterState ID must be a non-empty trimmed string");
  }
}

export class InvalidComponentInstanceIdError extends Error {
  override readonly name = "InvalidComponentInstanceIdError";

  constructor() {
    super("Component instance ID must be a non-empty trimmed string");
  }
}

export class InvalidComponentKindError extends Error {
  override readonly name = "InvalidComponentKindError";

  constructor() {
    super("Component kind must be a normalized dotted identifier");
  }
}

export class InvalidComponentRoleError extends Error {
  override readonly name = "InvalidComponentRoleError";

  constructor() {
    super("Component role must be a normalized dotted identifier");
  }
}

export class InvalidComponentDisplayNameError extends Error {
  override readonly name = "InvalidComponentDisplayNameError";

  constructor() {
    super("Component display name must be a non-empty string");
  }
}

export class InvalidComponentDefinitionReferenceError extends Error {
  override readonly name = "InvalidComponentDefinitionReferenceError";

  constructor(readonly field: keyof ComponentDefinitionReference | "definitionRef") {
    super(`Component definition reference ${field} must be a non-empty trimmed string`);
  }
}

const DOTTED_IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

function validateOpaqueId(value: unknown, createError: () => Error): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw createError();
  }
  return value;
}

function validateDottedIdentifier(value: unknown, createError: () => Error): string {
  if (typeof value !== "string" || !DOTTED_IDENTIFIER_PATTERN.test(value)) {
    throw createError();
  }
  return value;
}

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidComponentDisplayNameError();
  }
  return value.trim();
}

function copyDefinitionReference(reference: unknown): ComponentDefinitionReference {
  if (typeof reference !== "object" || reference === null || Array.isArray(reference)) {
    throw new InvalidComponentDefinitionReferenceError("definitionRef");
  }
  const values = reference as Record<string, unknown>;
  const read = (field: keyof ComponentDefinitionReference): string =>
    validateOpaqueId(values[field], () => new InvalidComponentDefinitionReferenceError(field));

  return Object.freeze({
    packageId: read("packageId"),
    packageVersion: read("packageVersion"),
    definitionId: read("definitionId"),
  });
}

export function createComponentDefinition(
  input: CreateComponentDefinitionInput
): ComponentDefinition {
  return Object.freeze({
    id: validateOpaqueId(input.id, () => new InvalidComponentDefinitionIdError()),
    kind: validateDottedIdentifier(input.kind, () => new InvalidComponentKindError()),
    displayName: normalizeDisplayName(input.displayName),
  });
}

export function createComponentInstallation(
  input: CreateComponentInstallationInput
): ComponentInstallation {
  const installation = {
    id: validateOpaqueId(input.id, () => new InvalidComponentInstallationIdError()),
    printerStateId: validateOpaqueId(
      input.printerStateId,
      () => new InvalidComponentPrinterStateIdError()
    ),
    componentInstanceId: validateOpaqueId(
      input.componentInstanceId,
      () => new InvalidComponentInstanceIdError()
    ),
    role: validateDottedIdentifier(input.role, () => new InvalidComponentRoleError()),
    kind: validateDottedIdentifier(input.kind, () => new InvalidComponentKindError()),
    displayName: normalizeDisplayName(input.displayName),
  };

  return Object.freeze(
    input.definitionRef !== undefined
      ? { ...installation, definitionRef: copyDefinitionReference(input.definitionRef) }
      : installation
  );
}
