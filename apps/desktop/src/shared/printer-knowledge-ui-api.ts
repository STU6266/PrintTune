export interface PrinterKnowledgeSeriesSelection {
  readonly packageId: string;
  readonly packageVersion: string;
  readonly seriesDefinitionId: string;
}

export interface PrinterKnowledgeModelSelection extends PrinterKnowledgeSeriesSelection {
  readonly modelDefinitionId: string;
}

export interface PrinterKnowledgeCatalogModel {
  readonly selection: PrinterKnowledgeModelSelection;
  readonly modelDisplayName: string;
}

export interface PrinterKnowledgeCatalogItem {
  readonly selection: PrinterKnowledgeSeriesSelection;
  readonly manufacturerDisplayName: string;
  readonly seriesDisplayName: string;
  readonly models: readonly PrinterKnowledgeCatalogModel[];
}

export interface PrinterKnowledgeCatalog {
  readonly items: readonly PrinterKnowledgeCatalogItem[];
  readonly unusablePackageCount: number;
}

export interface ClassifyKnownPrinterCommand {
  readonly printerId: string;
  readonly selection: PrinterKnowledgeSeriesSelection | PrinterKnowledgeModelSelection;
}

export interface ClassifyUnclassifiedPrinterCommand {
  readonly printerId: string;
}

export type PrinterKnowledgeClassification =
  | { readonly kind: "unclassified" }
  | {
      readonly kind: "known";
      readonly selection: PrinterKnowledgeSeriesSelection | PrinterKnowledgeModelSelection;
      readonly manufacturerDisplayName: string;
      readonly seriesDisplayName: string;
      readonly modelDisplayName?: string;
    };

export interface PrinterKnowledgeClassificationResult {
  readonly status: "selected" | "already_selected";
  readonly classification: PrinterKnowledgeClassification;
}

export interface PrinterKnowledgeApplicationCommand {
  readonly printerId: string;
  readonly printerStateId: string;
}

export type PrinterKnowledgeApplicationStatus =
  | { readonly kind: "no_selection"; readonly printerId: string; readonly printerStateId: string }
  | { readonly kind: "unclassified"; readonly printerId: string; readonly printerStateId: string }
  | {
      readonly kind: "known";
      readonly printerId: string;
      readonly printerStateId: string;
      readonly applicationStatus: "not_applied" | "applied";
    };

export interface PrinterKnowledgeApplyResult {
  readonly status: "applied" | "already_applied";
  readonly printerId: string;
  readonly printerStateId: string;
}

export const PRINTER_KNOWLEDGE_CATALOG_LIST_CHANNEL = "printer-knowledge:catalog:list" as const;
export const PRINTER_KNOWLEDGE_STATUS_GET_CHANNEL = "printer-knowledge:status:get" as const;
export const PRINTER_KNOWLEDGE_CLASSIFY_KNOWN_CHANNEL = "printer-knowledge:classify-known" as const;
export const PRINTER_KNOWLEDGE_CLASSIFY_UNCLASSIFIED_CHANNEL =
  "printer-knowledge:classify-unclassified" as const;
export const PRINTER_KNOWLEDGE_APPLICATION_STATUS_GET_CHANNEL =
  "printer-knowledge:application-status:get" as const;
export const PRINTER_KNOWLEDGE_APPLY_CHANNEL = "printer-knowledge:apply" as const;

export type PrinterKnowledgeApiErrorCode =
  | "no_active_workspace"
  | "printer_unavailable"
  | "package_unavailable"
  | "package_unusable"
  | "no_classification"
  | "unclassified"
  | "application_failed"
  | "save_failed"
  | "read_failed";

export type PrinterKnowledgeTransportResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PrinterKnowledgeApiErrorCode };

export class PrinterKnowledgeApiError extends Error {
  override readonly name = "PrinterKnowledgeApiError";

  constructor(readonly code: PrinterKnowledgeApiErrorCode) {
    super(`Printer Knowledge request failed: ${code}`);
  }
}

export interface PrinterKnowledgeApi {
  listPrinterKnowledgeCatalog(): Promise<PrinterKnowledgeCatalog>;
  getPrinterKnowledgeStatus(printerId: string): Promise<PrinterKnowledgeStatus>;
  classifyKnownPrinter(
    command: ClassifyKnownPrinterCommand
  ): Promise<PrinterKnowledgeClassificationResult>;
  classifyUnclassifiedPrinter(
    command: ClassifyUnclassifiedPrinterCommand
  ): Promise<PrinterKnowledgeClassificationResult>;
  getPrinterKnowledgeApplicationStatus(
    command: PrinterKnowledgeApplicationCommand
  ): Promise<PrinterKnowledgeApplicationStatus>;
  applyPrinterKnowledge(
    command: PrinterKnowledgeApplicationCommand
  ): Promise<PrinterKnowledgeApplyResult>;
}

type PrinterKnowledgeChannel =
  | typeof PRINTER_KNOWLEDGE_CATALOG_LIST_CHANNEL
  | typeof PRINTER_KNOWLEDGE_STATUS_GET_CHANNEL
  | typeof PRINTER_KNOWLEDGE_CLASSIFY_KNOWN_CHANNEL
  | typeof PRINTER_KNOWLEDGE_CLASSIFY_UNCLASSIFIED_CHANNEL
  | typeof PRINTER_KNOWLEDGE_APPLICATION_STATUS_GET_CHANNEL
  | typeof PRINTER_KNOWLEDGE_APPLY_CHANNEL;
type PrinterKnowledgeInvoke = (
  channel: PrinterKnowledgeChannel,
  payload?: unknown
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

function assertSelection(
  value: unknown
): PrinterKnowledgeSeriesSelection | PrinterKnowledgeModelSelection {
  if (!isRecord(value)) throw new TypeError("Invalid Printer Knowledge selection");
  const hasModel = Object.hasOwn(value, "modelDefinitionId");
  if (
    !hasExactKeys(value, [
      "packageId",
      "packageVersion",
      "seriesDefinitionId",
      ...(hasModel ? ["modelDefinitionId"] : []),
    ]) ||
    !isId(value.packageId) ||
    !isId(value.packageVersion) ||
    !isId(value.seriesDefinitionId) ||
    (hasModel && !isId(value.modelDefinitionId))
  ) {
    throw new TypeError("Invalid Printer Knowledge selection");
  }
  return Object.freeze({
    packageId: value.packageId,
    packageVersion: value.packageVersion,
    seriesDefinitionId: value.seriesDefinitionId,
    ...(hasModel ? { modelDefinitionId: value.modelDefinitionId as string } : {}),
  });
}

export function assertClassifyKnownPrinterCommand(value: unknown): ClassifyKnownPrinterCommand {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["printerId", "selection"]) ||
    !isId(value.printerId)
  ) {
    throw new TypeError("Invalid known Printer Knowledge command");
  }
  return Object.freeze({ printerId: value.printerId, selection: assertSelection(value.selection) });
}

export function assertClassifyUnclassifiedPrinterCommand(
  value: unknown
): ClassifyUnclassifiedPrinterCommand {
  if (!isRecord(value) || !hasExactKeys(value, ["printerId"]) || !isId(value.printerId)) {
    throw new TypeError("Invalid unclassified Printer Knowledge command");
  }
  return Object.freeze({ printerId: value.printerId });
}

export function assertPrinterKnowledgeStatusRequest(value: unknown): {
  readonly printerId: string;
} {
  if (!isRecord(value) || !hasExactKeys(value, ["printerId"]) || !isId(value.printerId)) {
    throw new TypeError("Invalid Printer Knowledge status request");
  }
  return Object.freeze({ printerId: value.printerId });
}

export function assertPrinterKnowledgeApplicationCommand(
  value: unknown
): PrinterKnowledgeApplicationCommand {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["printerId", "printerStateId"]) ||
    !isId(value.printerId) ||
    !isId(value.printerStateId)
  ) {
    throw new TypeError("Invalid Printer Knowledge application command");
  }
  return Object.freeze({ printerId: value.printerId, printerStateId: value.printerStateId });
}

function assertCatalog(value: unknown): PrinterKnowledgeCatalog {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["items", "unusablePackageCount"]) ||
    !Array.isArray(value.items) ||
    !Number.isInteger(value.unusablePackageCount) ||
    (value.unusablePackageCount as number) < 0
  ) {
    throw new TypeError("Invalid Printer Knowledge catalog response");
  }
  const items = value.items.map((item): PrinterKnowledgeCatalogItem => {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, [
        "selection",
        "manufacturerDisplayName",
        "seriesDisplayName",
        "models",
      ]) ||
      typeof item.manufacturerDisplayName !== "string" ||
      typeof item.seriesDisplayName !== "string" ||
      !Array.isArray(item.models)
    ) {
      throw new TypeError("Invalid Printer Knowledge catalog response");
    }
    const selection = assertSelection(item.selection);
    if ("modelDefinitionId" in selection) throw new TypeError("Invalid series catalog selection");
    const models = item.models.map((model): PrinterKnowledgeCatalogModel => {
      if (
        !isRecord(model) ||
        !hasExactKeys(model, ["selection", "modelDisplayName"]) ||
        typeof model.modelDisplayName !== "string"
      )
        throw new TypeError("Invalid model catalog response");
      const modelSelection = assertSelection(model.selection);
      if (!("modelDefinitionId" in modelSelection))
        throw new TypeError("Invalid model catalog selection");
      return Object.freeze({ selection: modelSelection, modelDisplayName: model.modelDisplayName });
    });
    return Object.freeze({
      selection,
      manufacturerDisplayName: item.manufacturerDisplayName,
      seriesDisplayName: item.seriesDisplayName,
      models: Object.freeze(models),
    });
  });
  return Object.freeze({
    items: Object.freeze(items),
    unusablePackageCount: value.unusablePackageCount as number,
  });
}

function assertStatus(value: unknown): PrinterKnowledgeStatus {
  if (
    !isRecord(value) ||
    !isRecord(value.printerState) ||
    !hasExactKeys(value.printerState, ["id", "label"]) ||
    !isId(value.printerState.id) ||
    value.printerState.label !== "Initialer Druckerzustand"
  )
    throw new TypeError("Invalid Printer Knowledge status response");
  const state = Object.freeze({ id: value.printerState.id, label: value.printerState.label });
  if (value.kind === "no_selection" || value.kind === "unclassified") {
    if (!hasExactKeys(value, ["kind", "printerState"]))
      throw new TypeError("Invalid Printer Knowledge status response");
    return Object.freeze({ kind: value.kind, printerState: state });
  }
  if (
    value.kind !== "known" ||
    typeof value.manufacturerDisplayName !== "string" ||
    typeof value.seriesDisplayName !== "string" ||
    (value.modelDisplayName !== undefined && typeof value.modelDisplayName !== "string") ||
    !["available", "unavailable", "unusable"].includes(value.packageAvailability as string)
  )
    throw new TypeError("Invalid Printer Knowledge status response");
  const expected = [
    "kind",
    "printerState",
    "manufacturerDisplayName",
    "seriesDisplayName",
    "packageAvailability",
    ...(value.modelDisplayName === undefined ? [] : ["modelDisplayName"]),
  ];
  if (!hasExactKeys(value, expected))
    throw new TypeError("Invalid Printer Knowledge status response");
  return Object.freeze({
    kind: "known",
    printerState: state,
    manufacturerDisplayName: value.manufacturerDisplayName,
    seriesDisplayName: value.seriesDisplayName,
    ...(value.modelDisplayName === undefined ? {} : { modelDisplayName: value.modelDisplayName }),
    packageAvailability: value.packageAvailability as "available" | "unavailable" | "unusable",
  });
}

function assertClassificationResult(value: unknown): PrinterKnowledgeClassificationResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["status", "classification"]) ||
    !["selected", "already_selected"].includes(value.status as string) ||
    !isRecord(value.classification)
  )
    throw new TypeError("Invalid Printer Knowledge classification response");
  const classification = value.classification;
  if (classification.kind === "unclassified") {
    if (!hasExactKeys(classification, ["kind"]))
      throw new TypeError("Invalid classification response");
    return Object.freeze({
      status: value.status as "selected" | "already_selected",
      classification: Object.freeze({ kind: "unclassified" }),
    });
  }
  const selection = assertSelection(classification.selection);
  if (
    classification.kind !== "known" ||
    typeof classification.manufacturerDisplayName !== "string" ||
    typeof classification.seriesDisplayName !== "string" ||
    (classification.modelDisplayName !== undefined &&
      typeof classification.modelDisplayName !== "string")
  )
    throw new TypeError("Invalid classification response");
  const expected = [
    "kind",
    "selection",
    "manufacturerDisplayName",
    "seriesDisplayName",
    ...(classification.modelDisplayName === undefined ? [] : ["modelDisplayName"]),
  ];
  if (!hasExactKeys(classification, expected))
    throw new TypeError("Invalid classification response");
  return Object.freeze({
    status: value.status as "selected" | "already_selected",
    classification: Object.freeze({
      kind: "known",
      selection,
      manufacturerDisplayName: classification.manufacturerDisplayName,
      seriesDisplayName: classification.seriesDisplayName,
      ...(classification.modelDisplayName === undefined
        ? {}
        : { modelDisplayName: classification.modelDisplayName }),
    }),
  });
}

function assertApplicationStatus(value: unknown): PrinterKnowledgeApplicationStatus {
  if (
    !isRecord(value) ||
    !isId(value.printerId) ||
    !isId(value.printerStateId) ||
    (value.kind !== "no_selection" && value.kind !== "unclassified" && value.kind !== "known")
  ) {
    throw new TypeError("Invalid Printer Knowledge application status response");
  }
  if (value.kind === "known") {
    if (
      !hasExactKeys(value, ["kind", "printerId", "printerStateId", "applicationStatus"]) ||
      (value.applicationStatus !== "not_applied" && value.applicationStatus !== "applied")
    ) {
      throw new TypeError("Invalid Printer Knowledge application status response");
    }
    return Object.freeze({
      kind: "known",
      printerId: value.printerId,
      printerStateId: value.printerStateId,
      applicationStatus: value.applicationStatus,
    });
  }
  if (!hasExactKeys(value, ["kind", "printerId", "printerStateId"])) {
    throw new TypeError("Invalid Printer Knowledge application status response");
  }
  return Object.freeze({
    kind: value.kind,
    printerId: value.printerId,
    printerStateId: value.printerStateId,
  });
}

function assertApplyResult(value: unknown): PrinterKnowledgeApplyResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["status", "printerId", "printerStateId"]) ||
    (value.status !== "applied" && value.status !== "already_applied") ||
    !isId(value.printerId) ||
    !isId(value.printerStateId)
  ) {
    throw new TypeError("Invalid Printer Knowledge apply response");
  }
  return Object.freeze({
    status: value.status,
    printerId: value.printerId,
    printerStateId: value.printerStateId,
  });
}

function unwrap<T>(value: unknown, assertValue: (candidate: unknown) => T): T {
  if (!isRecord(value) || (value.ok !== true && value.ok !== false))
    throw new TypeError("Invalid Printer Knowledge transport response");
  if (value.ok === false) {
    const codes: readonly PrinterKnowledgeApiErrorCode[] = [
      "no_active_workspace",
      "printer_unavailable",
      "package_unavailable",
      "package_unusable",
      "no_classification",
      "unclassified",
      "application_failed",
      "save_failed",
      "read_failed",
    ];
    if (
      !hasExactKeys(value, ["ok", "error"]) ||
      !codes.includes(value.error as PrinterKnowledgeApiErrorCode)
    )
      throw new TypeError("Invalid Printer Knowledge error response");
    throw new PrinterKnowledgeApiError(value.error as PrinterKnowledgeApiErrorCode);
  }
  if (!hasExactKeys(value, ["ok", "value"]))
    throw new TypeError("Invalid Printer Knowledge success response");
  return assertValue(value.value);
}

export function createPrinterKnowledgeApi(invoke: PrinterKnowledgeInvoke): PrinterKnowledgeApi {
  return Object.freeze({
    async listPrinterKnowledgeCatalog() {
      return unwrap(await invoke(PRINTER_KNOWLEDGE_CATALOG_LIST_CHANNEL), assertCatalog);
    },
    async getPrinterKnowledgeStatus(printerId: string) {
      const request = assertPrinterKnowledgeStatusRequest({ printerId });
      return unwrap(await invoke(PRINTER_KNOWLEDGE_STATUS_GET_CHANNEL, request), assertStatus);
    },
    async classifyKnownPrinter(command: ClassifyKnownPrinterCommand) {
      const request = assertClassifyKnownPrinterCommand(command);
      return unwrap(
        await invoke(PRINTER_KNOWLEDGE_CLASSIFY_KNOWN_CHANNEL, request),
        assertClassificationResult
      );
    },
    async classifyUnclassifiedPrinter(command: ClassifyUnclassifiedPrinterCommand) {
      const request = assertClassifyUnclassifiedPrinterCommand(command);
      return unwrap(
        await invoke(PRINTER_KNOWLEDGE_CLASSIFY_UNCLASSIFIED_CHANNEL, request),
        assertClassificationResult
      );
    },
    async getPrinterKnowledgeApplicationStatus(command: PrinterKnowledgeApplicationCommand) {
      const request = assertPrinterKnowledgeApplicationCommand(command);
      return unwrap(
        await invoke(PRINTER_KNOWLEDGE_APPLICATION_STATUS_GET_CHANNEL, request),
        assertApplicationStatus
      );
    },
    async applyPrinterKnowledge(command: PrinterKnowledgeApplicationCommand) {
      const request = assertPrinterKnowledgeApplicationCommand(command);
      return unwrap(await invoke(PRINTER_KNOWLEDGE_APPLY_CHANNEL, request), assertApplyResult);
    },
  });
}

export interface PrinterKnowledgeStateProjection {
  readonly id: string;
  readonly label: "Initialer Druckerzustand";
}

interface PrinterKnowledgeStatusBase {
  readonly printerState: PrinterKnowledgeStateProjection;
}

export type PrinterKnowledgeStatus = PrinterKnowledgeStatusBase &
  (
    | { readonly kind: "no_selection" }
    | { readonly kind: "unclassified" }
    | {
        readonly kind: "known";
        readonly manufacturerDisplayName: string;
        readonly seriesDisplayName: string;
        readonly modelDisplayName?: string;
        readonly packageAvailability: "available" | "unavailable" | "unusable";
      }
  );
