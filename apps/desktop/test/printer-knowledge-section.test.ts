import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  PrinterKnowledgeSectionView,
  confirmPrinterKnowledgeSelection,
  printerKnowledgeErrorMessage,
} from "../src/renderer/PrinterKnowledgeSection";
import { PrinterKnowledgeApiError } from "../src/shared/printer-knowledge-ui-api";

const STATE = { id: "state-a", label: "Initialer Druckerzustand" as const };
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
});
