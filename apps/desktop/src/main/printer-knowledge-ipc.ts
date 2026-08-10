import type { IpcMain, WebContents } from "electron";

import {
  PRINTER_KNOWLEDGE_CATALOG_LIST_CHANNEL,
  PRINTER_KNOWLEDGE_CLASSIFY_KNOWN_CHANNEL,
  PRINTER_KNOWLEDGE_CLASSIFY_UNCLASSIFIED_CHANNEL,
  PRINTER_KNOWLEDGE_STATUS_GET_CHANNEL,
  assertClassifyKnownPrinterCommand,
  assertClassifyUnclassifiedPrinterCommand,
  assertPrinterKnowledgeStatusRequest,
  type PrinterKnowledgeApiErrorCode,
  type PrinterKnowledgeTransportResult,
} from "../shared/printer-knowledge-ui-api";
import {
  InvalidPrinterKnowledgeModelSelectionError,
  InvalidPrinterKnowledgeSeriesSelectionError,
  PrinterKnowledgePackageIncompatibleError,
  PrinterKnowledgePackageUnavailableError,
  PrinterKnowledgePackageUnusableError,
  type PrinterKnowledgeClassificationService,
} from "./printer-knowledge-classification-service";
import type { PrinterKnowledgeUiService } from "./printer-knowledge-ui-service";
import { NoActiveWorkspaceError, PrinterNotFoundError } from "./printer-flow-application-service";
import { assertTrustedRendererSender } from "./trusted-renderer";

function safeError(
  error: unknown,
  fallback: "read_failed" | "save_failed"
): PrinterKnowledgeApiErrorCode {
  if (error instanceof NoActiveWorkspaceError) return "no_active_workspace";
  if (error instanceof PrinterNotFoundError) return "printer_unavailable";
  if (error instanceof PrinterKnowledgePackageUnavailableError) return "package_unavailable";
  if (
    error instanceof PrinterKnowledgePackageUnusableError ||
    error instanceof PrinterKnowledgePackageIncompatibleError ||
    error instanceof InvalidPrinterKnowledgeSeriesSelectionError ||
    error instanceof InvalidPrinterKnowledgeModelSelectionError
  ) {
    return "package_unusable";
  }
  return fallback;
}

async function transport<T>(
  operation: () => Promise<T>,
  fallback: "read_failed" | "save_failed"
): Promise<PrinterKnowledgeTransportResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error: safeError(error, fallback) };
  }
}

export function registerPrinterKnowledgeIpcHandlers(
  ipc: Pick<IpcMain, "handle">,
  uiService: PrinterKnowledgeUiService,
  classificationService: PrinterKnowledgeClassificationService,
  getTrustedRenderer: () => WebContents | undefined
): void {
  ipc.handle(PRINTER_KNOWLEDGE_CATALOG_LIST_CHANNEL, async (event) => {
    assertTrustedRendererSender(event, getTrustedRenderer());
    return transport(() => uiService.listCatalog(), "read_failed");
  });
  ipc.handle(PRINTER_KNOWLEDGE_STATUS_GET_CHANNEL, async (event, payload: unknown) => {
    assertTrustedRendererSender(event, getTrustedRenderer());
    return transport(
      () =>
        uiService.getPrinterKnowledgeStatus(assertPrinterKnowledgeStatusRequest(payload).printerId),
      "read_failed"
    );
  });
  ipc.handle(PRINTER_KNOWLEDGE_CLASSIFY_KNOWN_CHANNEL, async (event, payload: unknown) => {
    assertTrustedRendererSender(event, getTrustedRenderer());
    return transport(
      () => classificationService.classifyKnownPrinter(assertClassifyKnownPrinterCommand(payload)),
      "save_failed"
    );
  });
  ipc.handle(PRINTER_KNOWLEDGE_CLASSIFY_UNCLASSIFIED_CHANNEL, async (event, payload: unknown) => {
    assertTrustedRendererSender(event, getTrustedRenderer());
    return transport(
      () =>
        classificationService.classifyUnclassifiedPrinter(
          assertClassifyUnclassifiedPrinterCommand(payload)
        ),
      "save_failed"
    );
  });
}
