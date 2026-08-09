import type { Printer, PrinterState, Workspace } from "@printtune/contracts";

import { assertOptionalWorkspace } from "./workspace-api";

export const PRINTER_LIST_CHANNEL = "printer:list-active-workspace" as const;
export const PRINTER_CREATE_CHANNEL = "printer:create" as const;
export const PRINTER_GET_DETAIL_CHANNEL = "printer:get-detail" as const;

export interface CreatePrinterRequest {
  readonly name: string;
}

export interface GetPrinterDetailRequest {
  readonly id: string;
}

export interface PrinterListResponse {
  readonly activeWorkspace: Workspace | undefined;
  readonly printers: readonly Printer[];
}

export interface PrinterDetailResponse {
  readonly printer: Printer;
  readonly initialState: PrinterState;
}

export interface PrinterApi {
  listPrinters(): Promise<PrinterListResponse>;
  createPrinter(name: string): Promise<PrinterDetailResponse>;
  getPrinterDetail(id: string): Promise<PrinterDetailResponse>;
}

type PrinterChannel =
  typeof PRINTER_LIST_CHANNEL | typeof PRINTER_CREATE_CHANNEL | typeof PRINTER_GET_DETAIL_CHANNEL;
type PrinterInvoke = (channel: PrinterChannel, payload?: unknown) => Promise<unknown>;

const ISO_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const milliseconds = Date.parse(value);
  const normalized = value.includes(".")
    ? value.replace(/\.(\d{1,3})Z$/, (_, fraction: string) => `.${fraction.padEnd(3, "0")}Z`)
    : value.replace("Z", ".000Z");
  return !Number.isNaN(milliseconds) && new Date(milliseconds).toISOString() === normalized;
}

export function assertCreatePrinterRequest(value: unknown): CreatePrinterRequest {
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.name !== "string") {
    throw new TypeError("Invalid Printer create request");
  }
  return Object.freeze({ name: value.name });
}

export function assertGetPrinterDetailRequest(value: unknown): GetPrinterDetailRequest {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isId(value.id)) {
    throw new TypeError("Invalid Printer detail request");
  }
  return Object.freeze({ id: value.id });
}

function assertPrinter(value: unknown): Printer {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 5 ||
    !isId(value.id) ||
    !isId(value.workspaceId) ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt)
  ) {
    throw new TypeError("Invalid Printer response");
  }
  return Object.freeze({
    id: value.id,
    workspaceId: value.workspaceId,
    name: value.name,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}

function assertPrinterState(value: unknown): PrinterState {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 3 ||
    !isId(value.id) ||
    !isId(value.printerId) ||
    !isTimestamp(value.createdAt)
  ) {
    throw new TypeError("Invalid PrinterState response");
  }
  return Object.freeze({
    id: value.id,
    printerId: value.printerId,
    createdAt: value.createdAt,
  });
}

export function assertPrinterListResponse(value: unknown): PrinterListResponse {
  if (!isRecord(value) || Object.keys(value).length !== 2 || !Array.isArray(value.printers)) {
    throw new TypeError("Invalid Printer list response");
  }
  return Object.freeze({
    activeWorkspace: assertOptionalWorkspace(value.activeWorkspace),
    printers: Object.freeze(value.printers.map(assertPrinter)),
  });
}

export function assertPrinterDetailResponse(value: unknown): PrinterDetailResponse {
  if (!isRecord(value) || Object.keys(value).length !== 2) {
    throw new TypeError("Invalid Printer detail response");
  }
  const printer = assertPrinter(value.printer);
  const initialState = assertPrinterState(value.initialState);
  if (initialState.printerId !== printer.id) {
    throw new TypeError("PrinterState does not belong to Printer");
  }
  return Object.freeze({ printer, initialState });
}

export function createPrinterApi(invoke: PrinterInvoke): PrinterApi {
  return Object.freeze({
    async listPrinters() {
      return assertPrinterListResponse(await invoke(PRINTER_LIST_CHANNEL));
    },
    async createPrinter(name: string) {
      const request = assertCreatePrinterRequest({ name });
      return assertPrinterDetailResponse(await invoke(PRINTER_CREATE_CHANNEL, request));
    },
    async getPrinterDetail(id: string) {
      const request = assertGetPrinterDetailRequest({ id });
      return assertPrinterDetailResponse(await invoke(PRINTER_GET_DETAIL_CHANNEL, request));
    },
  });
}
