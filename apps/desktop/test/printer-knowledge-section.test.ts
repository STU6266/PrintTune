// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render as mount, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PrinterKnowledgeSection,
  PrinterKnowledgeSectionView,
  confirmPrinterKnowledgeSelection,
  printerKnowledgeErrorMessage,
} from "../src/renderer/PrinterKnowledgeSection";
import { PrinterKnowledgeApiError } from "../src/shared/printer-knowledge-ui-api";

const STATE = { id: "state-a", label: "Initialer Druckerzustand" as const };
const NO_SELECTION = { kind: "no_selection" as const, printerState: STATE };
const UNCLASSIFIED = { kind: "unclassified" as const, printerState: STATE };
const KNOWN = {
  kind: "known" as const,
  printerState: STATE,
  manufacturerDisplayName: "Maker",
  seriesDisplayName: "Series",
  modelDisplayName: "Model",
  packageAvailability: "available" as const,
};
const SELECTION = {
  packageId: "package-a",
  packageVersion: "1",
  seriesDefinitionId: "series-a",
  modelDefinitionId: "model-a",
};
const CATALOG = {
  items: [
    {
      selection: {
        packageId: "package-a",
        packageVersion: "1",
        seriesDefinitionId: "series-a",
      },
      manufacturerDisplayName: "Maker",
      seriesDisplayName: "Series",
      models: [{ selection: SELECTION, modelDisplayName: "Model" }],
    },
  ],
  unusablePackageCount: 0,
};
const base = {
  catalog: { items: [], unusablePackageCount: 0 },
  isLoading: false,
  isOpen: false,
  isSaving: false,
  pending: undefined,
  message: undefined,
  error: undefined,
  onOpen: vi.fn(),
  onCancel: vi.fn(),
  onSelect: vi.fn(),
  onConfirm: vi.fn(),
};
function render(
  status: Parameters<typeof PrinterKnowledgeSectionView>[0]["status"],
  overrides = {}
) {
  return renderToStaticMarkup(
    createElement(PrinterKnowledgeSectionView, { ...base, status, ...overrides })
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installApi(overrides: Record<string, unknown> = {}) {
  const api = {
    getPrinterKnowledgeStatus: vi.fn().mockResolvedValue(NO_SELECTION),
    listPrinterKnowledgeCatalog: vi.fn().mockResolvedValue(CATALOG),
    classifyKnownPrinter: vi
      .fn()
      .mockResolvedValue({ status: "selected", classification: { kind: "known" } }),
    classifyUnclassifiedPrinter: vi
      .fn()
      .mockResolvedValue({ status: "selected", classification: { kind: "unclassified" } }),
    ...overrides,
  };
  Object.defineProperty(window, "printTune", { configurable: true, value: api });
  return api;
}

afterEach(cleanup);

describe("PrinterKnowledgeSection", () => {
  it("renders no selection, known availability states, and unclassified", () => {
    expect(render({ kind: "no_selection", printerState: STATE })).toContain(
      "Noch kein Druckermodell ausgewählt"
    );
    const known = {
      kind: "known" as const,
      printerState: STATE,
      manufacturerDisplayName: "Snapshot Maker",
      seriesDisplayName: "Snapshot Series",
      modelDisplayName: "Snapshot Model",
      packageAvailability: "unavailable" as const,
    };
    const unavailable = render(known);
    expect(unavailable).toContain("Snapshot Series – Snapshot Model");
    expect(unavailable).toContain("Wissenspaket nicht verfügbar");
    expect(render({ ...known, packageAvailability: "unusable" })).toContain(
      "kann derzeit nicht verwendet werden"
    );
    expect(render({ kind: "unclassified", printerState: STATE })).toContain("Unbekannt / Eigenbau");
    expect(render({ kind: "unclassified", printerState: STATE })).not.toContain(
      "Technischer Zustand"
    );
  });

  it("keeps unclassified available with an empty catalog and shows safe warnings", () => {
    const markup = render(
      { kind: "no_selection", printerState: STATE },
      { isOpen: true, catalog: { items: [], unusablePackageCount: 2 } }
    );
    expect(markup).toContain("Keine lokalen Druckermodelle verfügbar");
    expect(markup).toContain("Unbekannt / Eigenbau");
    expect(markup).toContain("konnten nicht verwendet werden");
  });

  it("shows exact versions only when duplicate display choices need disambiguation", () => {
    const item = (version: string) => ({
      selection: { packageId: "p", packageVersion: version, seriesDefinitionId: "s" },
      manufacturerDisplayName: "Maker",
      seriesDisplayName: "Series",
      models: [],
    });
    const markup = render(
      { kind: "no_selection", printerState: STATE },
      { isOpen: true, catalog: { items: [item("1"), item("2")], unusablePackageCount: 0 } }
    );
    expect(markup).toContain("Version 1");
    expect(markup).toContain("Version 2");
  });

  it("also disambiguates equal versions and duplicate model display names", () => {
    const item = (packageId: string) => ({
      selection: { packageId, packageVersion: "same", seriesDefinitionId: "s" },
      manufacturerDisplayName: "Maker",
      seriesDisplayName: "Series",
      models: [
        {
          selection: {
            packageId,
            packageVersion: "same",
            seriesDefinitionId: "s",
            modelDefinitionId: "model-a",
          },
          modelDisplayName: "Model",
        },
        {
          selection: {
            packageId,
            packageVersion: "same",
            seriesDefinitionId: "s",
            modelDefinitionId: "model-b",
          },
          modelDisplayName: "Model",
        },
      ],
    });
    const markup = render(NO_SELECTION, {
      isOpen: true,
      catalog: { items: [item("package-a"), item("package-b")], unusablePackageCount: 0 },
    });
    expect(markup).toContain("Paket: package-a");
    expect(markup).toContain("Paket: package-b");
    expect(markup).toContain("Model · model-a");
    expect(markup).toContain("Model · model-b");
  });

  it("sends only exact references on explicit confirmation", async () => {
    const api = {
      classifyKnownPrinter: vi
        .fn()
        .mockResolvedValue({ status: "selected", classification: { kind: "known" } }),
      classifyUnclassifiedPrinter: vi
        .fn()
        .mockResolvedValue({ status: "selected", classification: { kind: "unclassified" } }),
    };
    const selection = {
      packageId: "p",
      packageVersion: "1",
      seriesDefinitionId: "s",
      modelDefinitionId: "m",
    };
    await confirmPrinterKnowledgeSelection(api as never, "printer-a", {
      kind: "known",
      selection,
      manufacturerDisplayName: "Display only",
      seriesDisplayName: "Display only",
      modelDisplayName: "Display only",
    });
    expect(api.classifyKnownPrinter).toHaveBeenCalledWith({ printerId: "printer-a", selection });
    expect(api.classifyKnownPrinter.mock.calls[0]?.[0]).not.toHaveProperty(
      "manufacturerDisplayName"
    );
    await confirmPrinterKnowledgeSelection(api as never, "printer-a", { kind: "unclassified" });
    expect(api.classifyUnclassifiedPrinter).toHaveBeenCalledWith({ printerId: "printer-a" });
  });

  it("disables all confirmation controls while saving and exposes no Apply action", () => {
    const markup = render(
      { kind: "no_selection", printerState: STATE },
      { isOpen: true, isSaving: true, pending: { kind: "unclassified" } }
    );
    expect(markup).toContain("Wird gespeichert");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("Druckerwissen anwenden");
    expect(markup).not.toContain("Wissen übernehmen");
  });

  it("maps stale selections to safe retry messages", () => {
    expect(
      printerKnowledgeErrorMessage(new PrinterKnowledgeApiError("package_unavailable"))
    ).toContain("nicht mehr verfügbar");
    expect(
      printerKnowledgeErrorMessage(new PrinterKnowledgeApiError("package_unusable"))
    ).toContain("nicht mehr verwendet");
    expect(printerKnowledgeErrorMessage(new Error("SQLite secret"))).toBe(
      "Das Druckermodell konnte nicht gespeichert werden."
    );
  });

  it("ignores a late Printer A load after Printer B becomes authoritative", async () => {
    const statusA = deferred<typeof NO_SELECTION>();
    const statusB = deferred<typeof UNCLASSIFIED>();
    const catalogA = deferred<typeof CATALOG>();
    const catalogB = deferred<typeof CATALOG>();
    const api = installApi({
      getPrinterKnowledgeStatus: vi.fn((id: string) =>
        id === "printer-a" ? statusA.promise : statusB.promise
      ),
      listPrinterKnowledgeCatalog: vi
        .fn()
        .mockImplementationOnce(() => catalogA.promise)
        .mockImplementationOnce(() => catalogB.promise),
    });
    const mounted = mount(createElement(PrinterKnowledgeSection, { printerId: "printer-a" }));
    mounted.rerender(createElement(PrinterKnowledgeSection, { printerId: "printer-b" }));
    statusB.resolve(UNCLASSIFIED);
    catalogB.resolve(CATALOG);
    expect(await screen.findByText("Unbekannt / Eigenbau")).toBeTruthy();
    statusA.resolve(NO_SELECTION);
    catalogA.resolve(CATALOG);
    await waitFor(() =>
      expect(screen.queryByText("Noch kein Druckermodell ausgewählt.")).toBeNull()
    );
    expect(api.getPrinterKnowledgeStatus).toHaveBeenCalledWith("printer-a");
    expect(api.getPrinterKnowledgeStatus).toHaveBeenCalledWith("printer-b");
  });

  it("discards Printer A pending selection when switching to Printer B", async () => {
    const api = installApi();
    const mounted = mount(createElement(PrinterKnowledgeSection, { printerId: "printer-a" }));
    await screen.findByRole("button", { name: "Druckermodell auswählen" });
    fireEvent.click(screen.getByRole("button", { name: "Druckermodell auswählen" }));
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    expect(screen.getByText("Ausgewählt:")).toBeTruthy();
    mounted.rerender(createElement(PrinterKnowledgeSection, { printerId: "printer-b" }));
    await waitFor(() => expect(screen.queryByText("Ausgewählt:")).toBeNull());
    expect(screen.queryByRole("button", { name: "Druckermodell bestätigen" })).toBeNull();
    expect(api.classifyKnownPrinter).not.toHaveBeenCalled();
  });

  it("does not leak a pending Printer A save result into Printer B", async () => {
    const saveA = deferred<{ status: "selected"; classification: { kind: "known" } }>();
    const api = installApi({ classifyKnownPrinter: vi.fn(() => saveA.promise) });
    const mounted = mount(createElement(PrinterKnowledgeSection, { printerId: "printer-a" }));
    await screen.findByRole("button", { name: "Druckermodell auswählen" });
    fireEvent.click(screen.getByRole("button", { name: "Druckermodell auswählen" }));
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    fireEvent.click(screen.getByRole("button", { name: "Druckermodell bestätigen" }));
    mounted.rerender(createElement(PrinterKnowledgeSection, { printerId: "printer-b" }));
    await screen.findByRole("button", { name: "Druckermodell auswählen" });
    saveA.resolve({ status: "selected", classification: { kind: "known" } });
    await waitFor(() => expect(screen.queryByText("Druckermodell gespeichert.")).toBeNull());
    expect(api.classifyKnownPrinter).toHaveBeenCalledWith({
      printerId: "printer-a",
      selection: SELECTION,
    });
  });

  it("confirms known and unclassified choices through authoritative reloads", async () => {
    const api = installApi({
      getPrinterKnowledgeStatus: vi
        .fn()
        .mockResolvedValueOnce(NO_SELECTION)
        .mockResolvedValueOnce(KNOWN)
        .mockResolvedValueOnce(UNCLASSIFIED),
    });
    mount(createElement(PrinterKnowledgeSection, { printerId: "printer-a" }));
    await screen.findByRole("button", { name: "Druckermodell auswählen" });
    fireEvent.click(screen.getByRole("button", { name: "Druckermodell auswählen" }));
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    expect(api.classifyKnownPrinter).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Druckermodell bestätigen" }));
    expect(await screen.findByText("Series – Model")).toBeTruthy();
    expect(api.classifyKnownPrinter).toHaveBeenCalledWith({
      printerId: "printer-a",
      selection: SELECTION,
    });
    expect(screen.queryByText("Ausgewählt:")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Druckermodell ändern" }));
    fireEvent.click(screen.getByRole("button", { name: "Unbekannt / Eigenbau" }));
    fireEvent.click(screen.getByRole("button", { name: "Druckermodell bestätigen" }));
    await waitFor(() =>
      expect(api.classifyUnclassifiedPrinter).toHaveBeenCalledWith({ printerId: "printer-a" })
    );
    await waitFor(() => expect(screen.getAllByText("Unbekannt / Eigenbau")).toHaveLength(1));
  });

  it("prevents mounted duplicate submission and restores disclosure focus on cancel", async () => {
    const pendingSave = deferred<{ status: "selected"; classification: { kind: "known" } }>();
    const api = installApi({ classifyKnownPrinter: vi.fn(() => pendingSave.promise) });
    mount(createElement(PrinterKnowledgeSection, { printerId: "printer-a" }));
    const disclosure = await screen.findByRole("button", { name: "Druckermodell auswählen" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    const confirm = screen.getByRole("button", { name: "Druckermodell bestätigen" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(api.classifyKnownPrinter).toHaveBeenCalledTimes(1);
    pendingSave.resolve({ status: "selected", classification: { kind: "known" } });
    await waitFor(() => expect(screen.queryByText("Ausgewählt:")).toBeNull());
    fireEvent.click(disclosure);
    const cancel = screen.getByRole("button", { name: "Abbrechen" });
    fireEvent.click(cancel);
    await waitFor(() => expect(document.activeElement).toBe(disclosure));
  });

  it("shows stale selection safely and refreshes without fallback", async () => {
    const api = installApi({
      classifyKnownPrinter: vi
        .fn()
        .mockRejectedValue(new PrinterKnowledgeApiError("package_unavailable")),
    });
    mount(createElement(PrinterKnowledgeSection, { printerId: "printer-a" }));
    await screen.findByRole("button", { name: "Druckermodell auswählen" });
    fireEvent.click(screen.getByRole("button", { name: "Druckermodell auswählen" }));
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    fireEvent.click(screen.getByRole("button", { name: "Druckermodell bestätigen" }));
    expect(await screen.findByText(/nicht mehr verfügbar/)).toBeTruthy();
    expect(api.getPrinterKnowledgeStatus).toHaveBeenCalledTimes(2);
    expect(api.listPrinterKnowledgeCatalog).toHaveBeenCalledTimes(2);
    expect(api.classifyKnownPrinter).toHaveBeenCalledWith({
      printerId: "printer-a",
      selection: SELECTION,
    });
  });
});
