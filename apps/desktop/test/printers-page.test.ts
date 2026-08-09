import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PrintersPageView } from "../src/renderer/pages/PrintersPage";

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
});
