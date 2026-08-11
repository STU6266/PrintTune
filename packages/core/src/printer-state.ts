import type { PrinterState } from "@printtune/contracts";

export interface CreatePrinterStateInput {
  readonly id: string;
  readonly printerId: string;
  readonly parentPrinterStateId?: string;
  readonly timestamp: string;
}

export class InvalidPrinterStateIdError extends Error {
  override readonly name = "InvalidPrinterStateIdError";

  constructor() {
    super("PrinterState ID must be a non-empty trimmed string");
  }
}

export class InvalidPrinterStatePrinterIdError extends Error {
  override readonly name = "InvalidPrinterStatePrinterIdError";

  constructor() {
    super("PrinterState Printer ID must be a non-empty trimmed string");
  }
}

export class InvalidPrinterStateTimestampError extends Error {
  override readonly name = "InvalidPrinterStateTimestampError";

  constructor() {
    super("PrinterState timestamp must be an ISO-8601 UTC string");
  }
}

export class InvalidPrinterStateParentIdError extends Error {
  override readonly name = "InvalidPrinterStateParentIdError";

  constructor() {
    super("PrinterState parent ID must be a different non-empty trimmed string");
  }
}

const ISO_UTC_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

function validateId(id: string): string {
  if (id.length === 0 || id.trim() !== id) {
    throw new InvalidPrinterStateIdError();
  }

  return id;
}

function validatePrinterId(printerId: string): string {
  if (printerId.length === 0 || printerId.trim() !== printerId) {
    throw new InvalidPrinterStatePrinterIdError();
  }

  return printerId;
}

function validateTimestamp(timestamp: string): string {
  const match = ISO_UTC_TIMESTAMP_PATTERN.exec(timestamp);
  const parsedTimestamp = Date.parse(timestamp);

  if (!match || Number.isNaN(parsedTimestamp)) {
    throw new InvalidPrinterStateTimestampError();
  }

  const parsedDate = new Date(parsedTimestamp);
  const [, year, month, day, hour, minute, second, fraction = "0"] = match;
  const milliseconds = Number(fraction.padEnd(3, "0"));

  if (
    parsedDate.getUTCFullYear() !== Number(year) ||
    parsedDate.getUTCMonth() + 1 !== Number(month) ||
    parsedDate.getUTCDate() !== Number(day) ||
    parsedDate.getUTCHours() !== Number(hour) ||
    parsedDate.getUTCMinutes() !== Number(minute) ||
    parsedDate.getUTCSeconds() !== Number(second) ||
    parsedDate.getUTCMilliseconds() !== milliseconds
  ) {
    throw new InvalidPrinterStateTimestampError();
  }

  return timestamp;
}

export function createPrinterState(input: CreatePrinterStateInput): PrinterState {
  const id = validateId(input.id);
  const parentPrinterStateId = input.parentPrinterStateId;
  if (
    parentPrinterStateId !== undefined &&
    (typeof parentPrinterStateId !== "string" ||
      parentPrinterStateId.length === 0 ||
      parentPrinterStateId.trim() !== parentPrinterStateId ||
      parentPrinterStateId === id)
  ) {
    throw new InvalidPrinterStateParentIdError();
  }

  return Object.freeze({
    id,
    printerId: validatePrinterId(input.printerId),
    ...(parentPrinterStateId === undefined ? {} : { parentPrinterStateId }),
    createdAt: validateTimestamp(input.timestamp),
  });
}
