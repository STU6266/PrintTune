import type { CanonicalUnit, FieldClaimTarget, FieldClaimValue } from "@printtune/contracts";

const FIELD_PATH_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/;
const CANONICAL_UNITS = new Set<CanonicalUnit>(["mm", "mm/s", "mm/s2", "degC", "mm3/s", "ratio"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => actualKeys.includes(key));
}

export function validateNormalizedId(value: unknown, createError: () => Error): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw createError();
  }
  return value;
}

export function copyFieldTarget(target: unknown, createError: () => Error): FieldClaimTarget {
  if (!isRecord(target)) {
    throw createError();
  }
  if (target.type === "printer_state" && hasExactKeys(target, ["type", "printerStateId"])) {
    return Object.freeze({
      type: "printer_state",
      printerStateId: validateNormalizedId(target.printerStateId, createError),
    });
  }
  if (
    target.type === "component_installation" &&
    hasExactKeys(target, ["type", "componentInstallationId"])
  ) {
    return Object.freeze({
      type: "component_installation",
      componentInstallationId: validateNormalizedId(target.componentInstallationId, createError),
    });
  }
  throw createError();
}

export function copyFieldValue(value: unknown, createError: () => Error): FieldClaimValue {
  if (!isRecord(value) || !hasExactKeys(value, ["type", "value"])) {
    throw createError();
  }
  if (value.type === "string" && typeof value.value === "string") {
    return Object.freeze({ type: "string", value: value.value });
  }
  if (value.type === "number" && typeof value.value === "number" && Number.isFinite(value.value)) {
    return Object.freeze({ type: "number", value: value.value });
  }
  if (value.type === "boolean" && typeof value.value === "boolean") {
    return Object.freeze({ type: "boolean", value: value.value });
  }
  throw createError();
}

export function validateFieldPath(value: unknown, createError: () => Error): string {
  if (typeof value !== "string" || !FIELD_PATH_PATTERN.test(value)) {
    throw createError();
  }
  return value;
}

export function validateFieldUnit(
  unit: unknown,
  value: FieldClaimValue,
  createError: () => Error
): CanonicalUnit | undefined {
  if (unit === undefined) {
    return undefined;
  }
  if (value.type !== "number" || !CANONICAL_UNITS.has(unit as CanonicalUnit)) {
    throw createError();
  }
  return unit as CanonicalUnit;
}
