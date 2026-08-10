import type { IpcMainInvokeEvent, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";

import { PrinterKnowledgePackageUnavailableError } from "../src/main/printer-knowledge-classification-service";
import { registerPrinterKnowledgeIpcHandlers } from "../src/main/printer-knowledge-ipc";
import { UntrustedRendererError } from "../src/main/trusted-renderer";
import {
  PRINTER_KNOWLEDGE_CATALOG_LIST_CHANNEL,
  PRINTER_KNOWLEDGE_CLASSIFY_KNOWN_CHANNEL,
  PRINTER_KNOWLEDGE_CLASSIFY_UNCLASSIFIED_CHANNEL,
  PRINTER_KNOWLEDGE_STATUS_GET_CHANNEL,
} from "../src/shared/printer-knowledge-ui-api";

function event(sender: WebContents) {
  return { sender } as IpcMainInvokeEvent;
}

function harness() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const handle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) =>
    handlers.set(channel, handler)
  );
  const ui = {
    listCatalog: vi.fn().mockResolvedValue({ items: [], unusablePackageCount: 0 }),
    getPrinterKnowledgeStatus: vi.fn().mockResolvedValue({
      kind: "no_selection",
      printerState: { id: "state-a", label: "Initialer Druckerzustand" },
    }),
  };
  const classification = {
    classifyKnownPrinter: vi
      .fn()
      .mockResolvedValue({ status: "selected", classification: { kind: "known" } }),
    classifyUnclassifiedPrinter: vi
      .fn()
      .mockResolvedValue({ status: "selected", classification: { kind: "unclassified" } }),
  };
  const trusted = { isDestroyed: () => false } as WebContents;
  registerPrinterKnowledgeIpcHandlers(
    { handle } as never,
    ui as never,
    classification as never,
    () => trusted
  );
  return { handlers, ui, classification, trusted };
}

describe("Printer Knowledge IPC", () => {
  it("registers fixed handlers and delegates safe commands", async () => {
    const { handlers, ui, classification, trusted } = harness();
    const known = {
      printerId: "printer-a",
      selection: { packageId: "p", packageVersion: "1", seriesDefinitionId: "s" },
    };
    await handlers.get(PRINTER_KNOWLEDGE_CATALOG_LIST_CHANNEL)?.(event(trusted));
    await handlers.get(PRINTER_KNOWLEDGE_STATUS_GET_CHANNEL)?.(event(trusted), {
      printerId: "printer-a",
    });
    await handlers.get(PRINTER_KNOWLEDGE_CLASSIFY_KNOWN_CHANNEL)?.(event(trusted), known);
    await handlers.get(PRINTER_KNOWLEDGE_CLASSIFY_UNCLASSIFIED_CHANNEL)?.(event(trusted), {
      printerId: "printer-a",
    });
    expect(ui.listCatalog).toHaveBeenCalledOnce();
    expect(ui.getPrinterKnowledgeStatus).toHaveBeenCalledWith("printer-a");
    expect(classification.classifyKnownPrinter).toHaveBeenCalledWith(known);
    expect(classification.classifyUnclassifiedPrinter).toHaveBeenCalledWith({
      printerId: "printer-a",
    });
    expect([...handlers.keys()]).toEqual([
      PRINTER_KNOWLEDGE_CATALOG_LIST_CHANNEL,
      PRINTER_KNOWLEDGE_STATUS_GET_CHANNEL,
      PRINTER_KNOWLEDGE_CLASSIFY_KNOWN_CHANNEL,
      PRINTER_KNOWLEDGE_CLASSIFY_UNCLASSIFIED_CHANNEL,
    ]);
  });

  it.each([
    PRINTER_KNOWLEDGE_CATALOG_LIST_CHANNEL,
    PRINTER_KNOWLEDGE_STATUS_GET_CHANNEL,
    PRINTER_KNOWLEDGE_CLASSIFY_KNOWN_CHANNEL,
    PRINTER_KNOWLEDGE_CLASSIFY_UNCLASSIFIED_CHANNEL,
  ])("requires the trusted sender on %s", async (channel) => {
    const { handlers } = harness();
    await expect(
      handlers.get(channel)?.(event({ isDestroyed: () => false } as WebContents), {
        printerId: "printer-a",
      })
    ).rejects.toBeInstanceOf(UntrustedRendererError);
  });

  it("maps expected and unexpected write errors without technical details", async () => {
    const expected = harness();
    expected.classification.classifyKnownPrinter.mockRejectedValueOnce(
      new PrinterKnowledgePackageUnavailableError()
    );
    await expect(
      expected.handlers.get(PRINTER_KNOWLEDGE_CLASSIFY_KNOWN_CHANNEL)?.(event(expected.trusted), {
        printerId: "printer-a",
        selection: { packageId: "p", packageVersion: "1", seriesDefinitionId: "s" },
      })
    ).resolves.toEqual({ ok: false, error: "package_unavailable" });
    const unexpected = harness();
    unexpected.classification.classifyUnclassifiedPrinter.mockRejectedValueOnce(
      new Error("SQLite secret")
    );
    await expect(
      unexpected.handlers.get(PRINTER_KNOWLEDGE_CLASSIFY_UNCLASSIFIED_CHANNEL)?.(
        event(unexpected.trusted),
        { printerId: "printer-a" }
      )
    ).resolves.toEqual({ ok: false, error: "save_failed" });
  });
});
