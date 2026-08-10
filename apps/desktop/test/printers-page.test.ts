// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render as mount, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrintersPage, PrintersPageView } from "../src/renderer/pages/PrintersPage";

const TIMESTAMP = "2026-08-09T10:00:00.000Z";
const WORKSPACE = {
  id: "workspace-a",
  name: "Werkstatt",
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
};
const PRINTER = {
  id: "printer-a",
  workspaceId: WORKSPACE.id,
  name: "Werkstattdrucker",
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
};
const PRINTER_B = { ...PRINTER, id: "printer-b", name: "Zweiter Drucker" };
const DETAIL_A = {
  printer: PRINTER,
  initialState: { id: "state-a", printerId: PRINTER.id, createdAt: TIMESTAMP },
};
const DETAIL_B = {
  printer: PRINTER_B,
  initialState: { id: "state-b", printerId: PRINTER_B.id, createdAt: TIMESTAMP },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function fields(value: string) {
  return [
    {
      field: "extruderType" as const,
      status: "resolved" as const,
      reasonCode: "single_claim" as const,
      value,
    },
  ];
}

function render(overrides: Partial<Parameters<typeof PrintersPageView>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(PrintersPageView, {
      activeWorkspace: WORKSPACE,
      printers: [],
      detail: undefined,
      name: "",
      isLoading: false,
      isCreating: false,
      error: undefined,
      onNameChange: vi.fn(),
      onCreate: vi.fn(),
      onOpen: vi.fn(),
      ...overrides,
    })
  );
}

afterEach(cleanup);

describe("PrintersPage renderer states", () => {
  it("shows the no-active-Workspace state without create controls", () => {
    const markup = render({ activeWorkspace: undefined });
    expect(markup).toContain("Wähle zuerst einen Workspace aus.");
    expect(markup).not.toContain("Drucker anlegen");
  });

  it("shows an empty list and the minimal creation interaction", () => {
    const markup = render();
    expect(markup).toContain("Noch keine Drucker");
    expect(markup).toContain("Druckername");
    expect(markup).toContain("Drucker anlegen");
  });

  it("renders a Printer list with an open action", () => {
    const markup = render({ printers: [PRINTER] });
    expect(markup).toContain("Werkstattdrucker");
    expect(markup).toContain("Öffnen");
    expect(markup).toContain("Angelegt:");
  });

  it("renders identity and the immutable initial PrinterState", () => {
    const markup = render({
      printers: [PRINTER],
      detail: {
        printer: PRINTER,
        initialState: { id: "state-a", printerId: PRINTER.id, createdAt: TIMESTAMP },
      },
    });
    expect(markup).toContain("Initialer Druckerzustand");
    expect(markup).toContain("unveränderliche Zustand");
    expect(markup).not.toContain("Aktueller Druckerzustand");
  });

  it("renders a simple user-facing error without technical internals", () => {
    const markup = render({ error: "Der Drucker konnte nicht geöffnet werden." });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("konnte nicht geöffnet werden");
    expect(markup).not.toContain("SQLite");
  });

  it("ignores a late post-Apply technical refresh after Printer B is opened", async () => {
    const latePrinterAFields = deferred<ReturnType<typeof fields>>();
    let printerAReadCount = 0;
    let applied = false;
    const api = {
      listPrinters: vi.fn().mockResolvedValue({
        activeWorkspace: WORKSPACE,
        printers: [PRINTER, PRINTER_B],
      }),
      createPrinter: vi.fn(),
      getPrinterDetail: vi.fn((id: string) =>
        Promise.resolve(id === PRINTER.id ? DETAIL_A : DETAIL_B)
      ),
      readPrinterTechnicalFields: vi.fn((id: string) => {
        if (id === PRINTER.id) {
          printerAReadCount += 1;
          return printerAReadCount === 1
            ? Promise.resolve(fields("A vor Anwendung"))
            : latePrinterAFields.promise;
        }
        return Promise.resolve(fields("B technisch"));
      }),
      addManualPrinterTechnicalClaim: vi.fn(),
      getPrinterKnowledgeStatus: vi.fn((id: string) =>
        Promise.resolve(
          id === PRINTER.id
            ? {
                kind: "known",
                printerState: { id: "state-a", label: "Initialer Druckerzustand" },
                manufacturerDisplayName: "Maker",
                seriesDisplayName: "Series",
                packageAvailability: "available",
              }
            : {
                kind: "unclassified",
                printerState: { id: "state-b", label: "Initialer Druckerzustand" },
              }
        )
      ),
      listPrinterKnowledgeCatalog: vi.fn().mockResolvedValue({
        items: [],
        unusablePackageCount: 0,
      }),
      getPrinterKnowledgeApplicationStatus: vi.fn(
        (command: { printerId: string; printerStateId: string }) =>
          Promise.resolve(
            command.printerId === PRINTER.id
              ? {
                  kind: "known",
                  ...command,
                  applicationStatus: applied ? "applied" : "not_applied",
                }
              : { kind: "unclassified", ...command }
          )
      ),
      applyPrinterKnowledge: vi.fn((command: { printerId: string; printerStateId: string }) => {
        applied = true;
        return Promise.resolve({ status: "applied", ...command });
      }),
      classifyKnownPrinter: vi.fn(),
      classifyUnclassifiedPrinter: vi.fn(),
    };
    Object.defineProperty(window, "printTune", { configurable: true, value: api });

    mount(createElement(PrintersPage));
    await waitFor(() => expect(api.listPrinters).toHaveBeenCalledTimes(1));
    fireEvent.click((await screen.findAllByRole("button", { name: "Öffnen" }))[0]!);
    expect(await screen.findByText("Bestätigt: A vor Anwendung")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Druckerwissen anwenden" }));
    fireEvent.click(screen.getByRole("button", { name: "Wissen anwenden" }));
    await waitFor(() =>
      expect(
        api.readPrinterTechnicalFields.mock.calls.filter(([id]) => id === PRINTER.id)
      ).toHaveLength(2)
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Öffnen" })[1]!);
    expect(await screen.findByRole("heading", { name: PRINTER_B.name })).toBeTruthy();
    expect(await screen.findByText("Bestätigt: B technisch")).toBeTruthy();

    latePrinterAFields.resolve(fields("A nach Anwendung"));
    await waitFor(() => expect(screen.queryByText("Bestätigt: A nach Anwendung")).toBeNull());
    expect(screen.getByRole("heading", { name: PRINTER_B.name })).toBeTruthy();
    expect(screen.getByText("Bestätigt: B technisch")).toBeTruthy();
  });

  it("ignores a late normal detail load after a different Printer is opened", async () => {
    const lateDetailA = deferred<typeof DETAIL_A>();
    const lateFieldsA = deferred<ReturnType<typeof fields>>();
    const api = {
      listPrinters: vi.fn().mockResolvedValue({
        activeWorkspace: WORKSPACE,
        printers: [PRINTER, PRINTER_B],
      }),
      createPrinter: vi.fn(),
      getPrinterDetail: vi.fn((id: string) =>
        id === PRINTER.id ? lateDetailA.promise : Promise.resolve(DETAIL_B)
      ),
      readPrinterTechnicalFields: vi.fn((id: string) =>
        id === PRINTER.id ? lateFieldsA.promise : Promise.resolve(fields("B zuerst"))
      ),
      addManualPrinterTechnicalClaim: vi.fn(),
      getPrinterKnowledgeStatus: vi.fn().mockResolvedValue({
        kind: "unclassified",
        printerState: { id: "state-b", label: "Initialer Druckerzustand" },
      }),
      listPrinterKnowledgeCatalog: vi
        .fn()
        .mockResolvedValue({ items: [], unusablePackageCount: 0 }),
      getPrinterKnowledgeApplicationStatus: vi.fn(
        (command: { printerId: string; printerStateId: string }) =>
          Promise.resolve({ kind: "unclassified", ...command })
      ),
      applyPrinterKnowledge: vi.fn(),
      classifyKnownPrinter: vi.fn(),
      classifyUnclassifiedPrinter: vi.fn(),
    };
    Object.defineProperty(window, "printTune", { configurable: true, value: api });

    mount(createElement(PrintersPage));
    const openButtons = await screen.findAllByRole("button", { name: "Öffnen" });
    fireEvent.click(openButtons[0]!);
    fireEvent.click(openButtons[1]!);
    expect(await screen.findByText("Bestätigt: B zuerst")).toBeTruthy();

    lateDetailA.resolve(DETAIL_A);
    lateFieldsA.resolve(fields("A verspätet"));
    await waitFor(() => expect(screen.queryByText("Bestätigt: A verspätet")).toBeNull());
    expect(screen.getByRole("heading", { name: PRINTER_B.name })).toBeTruthy();
    expect(screen.getByText("Bestätigt: B zuerst")).toBeTruthy();
  });
});
