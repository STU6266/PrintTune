import { describe, expect, it, vi } from "vitest";

import {
  PRINTER_KNOWLEDGE_CATALOG_LIST_CHANNEL,
  PRINTER_KNOWLEDGE_APPLICATION_STATUS_GET_CHANNEL,
  PRINTER_KNOWLEDGE_APPLY_CHANNEL,
  PRINTER_KNOWLEDGE_CLASSIFY_KNOWN_CHANNEL,
  PRINTER_KNOWLEDGE_CLASSIFY_UNCLASSIFIED_CHANNEL,
  PRINTER_KNOWLEDGE_STATUS_GET_CHANNEL,
  PrinterKnowledgeApiError,
  createPrinterKnowledgeApi,
} from "../src/shared/printer-knowledge-ui-api";

const STATE = { id: "state-a", label: "Initialer Druckerzustand" as const };
const CATALOG = { items: [], unusablePackageCount: 1 };
const RESULT = { status: "selected" as const, classification: { kind: "unclassified" as const } };

describe("Printer Knowledge preload API", () => {
  it("uses six fixed channels with narrow payloads", async () => {
    const invoke = vi.fn(async (channel: string) => ({
      ok: true,
      value:
        channel === PRINTER_KNOWLEDGE_CATALOG_LIST_CHANNEL
          ? CATALOG
          : channel === PRINTER_KNOWLEDGE_STATUS_GET_CHANNEL
            ? { kind: "no_selection", printerState: STATE }
            : channel === PRINTER_KNOWLEDGE_APPLICATION_STATUS_GET_CHANNEL
              ? {
                  kind: "known",
                  printerId: "printer-a",
                  printerStateId: "state-a",
                  applicationStatus: "not_applied",
                }
              : channel === PRINTER_KNOWLEDGE_APPLY_CHANNEL
                ? { status: "applied", printerId: "printer-a", printerStateId: "state-a" }
                : RESULT,
    }));
    const api = createPrinterKnowledgeApi(invoke);
    const selection = { packageId: "p", packageVersion: "1", seriesDefinitionId: "s" };
    await api.listPrinterKnowledgeCatalog();
    await api.getPrinterKnowledgeStatus("printer-a");
    await api.classifyKnownPrinter({ printerId: "printer-a", selection });
    await api.classifyUnclassifiedPrinter({ printerId: "printer-a" });
    const applicationCommand = { printerId: "printer-a", printerStateId: "state-a" };
    await api.getPrinterKnowledgeApplicationStatus(applicationCommand);
    await api.applyPrinterKnowledge(applicationCommand);
    expect(invoke.mock.calls).toEqual([
      [PRINTER_KNOWLEDGE_CATALOG_LIST_CHANNEL],
      [PRINTER_KNOWLEDGE_STATUS_GET_CHANNEL, { printerId: "printer-a" }],
      [PRINTER_KNOWLEDGE_CLASSIFY_KNOWN_CHANNEL, { printerId: "printer-a", selection }],
      [PRINTER_KNOWLEDGE_CLASSIFY_UNCLASSIFIED_CHANNEL, { printerId: "printer-a" }],
      [PRINTER_KNOWLEDGE_APPLICATION_STATUS_GET_CHANNEL, applicationCommand],
      [PRINTER_KNOWLEDGE_APPLY_CHANNEL, applicationCommand],
    ]);
  });

  it("validates and freezes catalog/status responses", async () => {
    const catalog = await createPrinterKnowledgeApi(async () => ({
      ok: true,
      value: CATALOG,
    })).listPrinterKnowledgeCatalog();
    expect(catalog).toEqual(CATALOG);
    expect(Object.isFrozen(catalog)).toBe(true);
    await expect(
      createPrinterKnowledgeApi(async () => ({
        ok: true,
        value: {
          kind: "known",
          printerState: STATE,
          manufacturerDisplayName: "M",
          seriesDisplayName: "S",
          packageAvailability: "raw-error",
        },
      })).getPrinterKnowledgeStatus("printer-a")
    ).rejects.toThrow(TypeError);
  });

  it("exposes only validated safe error codes", async () => {
    const api = createPrinterKnowledgeApi(async () => ({
      ok: false,
      error: "package_unavailable",
    }));
    await expect(api.classifyUnclassifiedPrinter({ printerId: "printer-a" })).rejects.toEqual(
      expect.objectContaining<Partial<PrinterKnowledgeApiError>>({ code: "package_unavailable" })
    );
    await expect(
      createPrinterKnowledgeApi(async () => ({
        ok: false,
        error: "SQLite failed",
      })).listPrinterKnowledgeCatalog()
    ).rejects.toThrow(TypeError);
  });

  it("rejects malformed commands before IPC", async () => {
    const invoke = vi.fn();
    const api = createPrinterKnowledgeApi(invoke);
    await expect(
      api.classifyKnownPrinter({
        printerId: "printer-a",
        selection: { packageId: " p", packageVersion: "1", seriesDefinitionId: "s" },
      })
    ).rejects.toThrow(TypeError);
    await expect(
      api.applyPrinterKnowledge({
        printerId: "printer-a",
        printerStateId: " state-a",
        extra: "not allowed",
      } as never)
    ).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("validates narrow application responses and rejects internal fields", async () => {
    const command = { printerId: "printer-a", printerStateId: "state-a" };
    await expect(
      createPrinterKnowledgeApi(async () => ({
        ok: true,
        value: { ...command, status: "applied", applicationId: "secret" },
      })).applyPrinterKnowledge(command)
    ).rejects.toThrow(TypeError);
    await expect(
      createPrinterKnowledgeApi(async () => ({
        ok: true,
        value: { ...command, kind: "known", applicationStatus: "applied" },
      })).getPrinterKnowledgeApplicationStatus(command)
    ).resolves.toEqual({ ...command, kind: "known", applicationStatus: "applied" });
  });
});
