import type { IpcMainInvokeEvent, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";

import { PrinterKnowledgePackageUnavailableError } from "../src/main/printer-knowledge-classification-service";
import { PrinterKnowledgeApplicationError } from "../src/main/printer-knowledge-application-service";
import { registerPrinterKnowledgeIpcHandlers } from "../src/main/printer-knowledge-ipc";
import { UntrustedRendererError } from "../src/main/trusted-renderer";
import {
  PRINTER_KNOWLEDGE_CATALOG_LIST_CHANNEL,
  PRINTER_KNOWLEDGE_APPLICATION_STATUS_GET_CHANNEL,
  PRINTER_KNOWLEDGE_APPLY_CHANNEL,
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
  const application = {
    getApplicationStatus: vi.fn().mockResolvedValue({ kind: "no_selection" }),
    applyCurrentKnowledgeToPrinterState: vi.fn().mockResolvedValue({
      status: "applied",
      printerId: "printer-a",
      printerStateId: "state-a",
    }),
  };
  const trusted = { isDestroyed: () => false } as WebContents;
  registerPrinterKnowledgeIpcHandlers(
    { handle } as never,
    ui as never,
    classification as never,
    application as never,
    () => trusted
  );
  return { handlers, ui, classification, application, trusted };
}

describe("Printer Knowledge IPC", () => {
  it("registers fixed handlers and delegates safe commands", async () => {
    const { handlers, ui, classification, application, trusted } = harness();
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
    const applicationCommand = { printerId: "printer-a", printerStateId: "state-a" };
    await handlers.get(PRINTER_KNOWLEDGE_APPLICATION_STATUS_GET_CHANNEL)?.(
      event(trusted),
      applicationCommand
    );
    await handlers.get(PRINTER_KNOWLEDGE_APPLY_CHANNEL)?.(event(trusted), applicationCommand);
    expect(ui.listCatalog).toHaveBeenCalledOnce();
    expect(ui.getPrinterKnowledgeStatus).toHaveBeenCalledWith("printer-a");
    expect(classification.classifyKnownPrinter).toHaveBeenCalledWith(known);
    expect(classification.classifyUnclassifiedPrinter).toHaveBeenCalledWith({
      printerId: "printer-a",
    });
    expect(application.getApplicationStatus).toHaveBeenCalledWith(applicationCommand);
    expect(application.applyCurrentKnowledgeToPrinterState).toHaveBeenCalledWith(
      applicationCommand
    );
    expect([...handlers.keys()]).toEqual([
      PRINTER_KNOWLEDGE_CATALOG_LIST_CHANNEL,
      PRINTER_KNOWLEDGE_STATUS_GET_CHANNEL,
      PRINTER_KNOWLEDGE_CLASSIFY_KNOWN_CHANNEL,
      PRINTER_KNOWLEDGE_CLASSIFY_UNCLASSIFIED_CHANNEL,
      PRINTER_KNOWLEDGE_APPLICATION_STATUS_GET_CHANNEL,
      PRINTER_KNOWLEDGE_APPLY_CHANNEL,
    ]);
  });

  it.each([
    PRINTER_KNOWLEDGE_CATALOG_LIST_CHANNEL,
    PRINTER_KNOWLEDGE_STATUS_GET_CHANNEL,
    PRINTER_KNOWLEDGE_CLASSIFY_KNOWN_CHANNEL,
    PRINTER_KNOWLEDGE_CLASSIFY_UNCLASSIFIED_CHANNEL,
    PRINTER_KNOWLEDGE_APPLICATION_STATUS_GET_CHANNEL,
    PRINTER_KNOWLEDGE_APPLY_CHANNEL,
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

  it("validates application commands and maps application failures safely", async () => {
    const invalid = harness();
    await expect(
      invalid.handlers.get(PRINTER_KNOWLEDGE_APPLY_CHANNEL)?.(event(invalid.trusted), {
        printerId: "printer-a",
        printerStateId: "state-a",
        packageId: "not-allowed",
      })
    ).resolves.toEqual({ ok: false, error: "save_failed" });
    expect(invalid.application.applyCurrentKnowledgeToPrinterState).not.toHaveBeenCalled();

    const unavailable = harness();
    unavailable.application.applyCurrentKnowledgeToPrinterState.mockRejectedValueOnce(
      new PrinterKnowledgeApplicationError("knowledge_package_not_available")
    );
    await expect(
      unavailable.handlers.get(PRINTER_KNOWLEDGE_APPLY_CHANNEL)?.(event(unavailable.trusted), {
        printerId: "printer-a",
        printerStateId: "state-a",
      })
    ).resolves.toEqual({ ok: false, error: "package_unavailable" });

    const failed = harness();
    failed.application.applyCurrentKnowledgeToPrinterState.mockRejectedValueOnce(
      new Error("SQLite secret")
    );
    await expect(
      failed.handlers.get(PRINTER_KNOWLEDGE_APPLY_CHANNEL)?.(event(failed.trusted), {
        printerId: "printer-a",
        printerStateId: "state-a",
      })
    ).resolves.toEqual({ ok: false, error: "save_failed" });
  });
});
