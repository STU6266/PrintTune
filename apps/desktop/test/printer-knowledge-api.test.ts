import { describe, expect, it, vi } from "vitest";

import {
  PRINTER_KNOWLEDGE_CATALOG_LIST_CHANNEL,
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
  it("uses four fixed channels with narrow payloads", async () => {
    const invoke = vi.fn(async (channel: string) => ({
      ok: true,
      value:
        channel === PRINTER_KNOWLEDGE_CATALOG_LIST_CHANNEL
          ? CATALOG
          : channel === PRINTER_KNOWLEDGE_STATUS_GET_CHANNEL
            ? { kind: "no_selection", printerState: STATE }
            : RESULT,
    }));
    const api = createPrinterKnowledgeApi(invoke);
    const selection = { packageId: "p", packageVersion: "1", seriesDefinitionId: "s" };
    await api.listPrinterKnowledgeCatalog();
    await api.getPrinterKnowledgeStatus("printer-a");
    await api.classifyKnownPrinter({ printerId: "printer-a", selection });
    await api.classifyUnclassifiedPrinter({ printerId: "printer-a" });
    expect(invoke.mock.calls).toEqual([
      [PRINTER_KNOWLEDGE_CATALOG_LIST_CHANNEL],
      [PRINTER_KNOWLEDGE_STATUS_GET_CHANNEL, { printerId: "printer-a" }],
      [PRINTER_KNOWLEDGE_CLASSIFY_KNOWN_CHANNEL, { printerId: "printer-a", selection }],
      [PRINTER_KNOWLEDGE_CLASSIFY_UNCLASSIFIED_CHANNEL, { printerId: "printer-a" }],
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
    expect(invoke).not.toHaveBeenCalled();
  });
});
