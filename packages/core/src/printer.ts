import type { Printer } from "@printtune/contracts";

export interface CreatePrinterInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly timestamp: string;
}

export class InvalidPrinterIdError extends Error {
  override readonly name = "InvalidPrinterIdError";

  constructor() {
    super("Printer ID must be a non-empty trimmed string");
  }
}

export class InvalidPrinterWorkspaceIdError extends Error {
  override readonly name = "InvalidPrinterWorkspaceIdError";

  constructor() {
    super("Printer Workspace ID must be a non-empty trimmed string");
  }
}

export class InvalidPrinterNameError extends Error {
  override readonly name = "InvalidPrinterNameError";

  constructor() {
    super("Printer name must not be empty");
  }
}

export class InvalidPrinterTimestampError extends Error {
  override readonly name = "InvalidPrinterTimestampError";

  constructor() {
    super("Printer timestamp must be an ISO-8601 UTC string");
  }
}

const ISO_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function validateId(id: string): string {
  if (id.length === 0 || id.trim() !== id) {
    throw new InvalidPrinterIdError();
  }

  return id;
}

function validateWorkspaceId(workspaceId: string): string {
  if (workspaceId.length === 0 || workspaceId.trim() !== workspaceId) {
    throw new InvalidPrinterWorkspaceIdError();
  }

  return workspaceId;
}

function normalizeName(name: string): string {
  const normalizedName = name.trim();

  if (normalizedName.length === 0) {
    throw new InvalidPrinterNameError();
  }

  return normalizedName;
}

function validateTimestamp(timestamp: string): string {
  if (!ISO_UTC_TIMESTAMP_PATTERN.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    throw new InvalidPrinterTimestampError();
  }

  return timestamp;
}

export function createPrinter(input: CreatePrinterInput): Printer {
  const timestamp = validateTimestamp(input.timestamp);

  return {
    id: validateId(input.id),
    workspaceId: validateWorkspaceId(input.workspaceId),
    name: normalizeName(input.name),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function renamePrinter(printer: Printer, name: string, timestamp: string): Printer {
  return {
    ...printer,
    name: normalizeName(name),
    updatedAt: validateTimestamp(timestamp),
  };
}
