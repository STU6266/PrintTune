import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  PrinterTechnicalDataSection,
  technicalFieldStatusText,
} from "../src/renderer/PrinterTechnicalDataSection";
import type { TechnicalFieldSummary } from "../src/shared/printer-technical-data-api";

const MISSING_FIELDS: readonly TechnicalFieldSummary[] = [
  { field: "nozzleDiameter", status: "missing", reasonCode: "no_usable_claims", unit: "mm" },
  { field: "extruderType", status: "missing", reasonCode: "no_usable_claims" },
  {
    field: "hotendMaxTemperature",
    status: "missing",
    reasonCode: "no_usable_claims",
    unit: "degC",
  },
];

describe("PrinterTechnicalDataSection", () => {
  it("shows exactly the three fields and their appropriate input types", () => {
    const markup = renderToStaticMarkup(
      createElement(PrinterTechnicalDataSection, {
        fields: MISSING_FIELDS,
        isLoading: false,
        onSave: vi.fn(),
      })
    );
    expect(markup).toContain("Technische Angaben");
    expect(markup).toContain("Düsendurchmesser");
    expect(markup).toContain("Extrudertyp");
    expect(markup).toContain("Maximale Hotend-Temperatur");
    expect(markup.match(/type="number"/g)).toHaveLength(2);
    expect(markup.match(/type="text"/g)).toHaveLength(1);
    expect(markup).toContain("Ich bin mir sicher");
    expect(markup).toContain("Ich bin mir nicht sicher");
    expect(markup).toContain("Angabe speichern");
    expect(markup).toContain("nicht die normale Drucktemperatur");
  });

  it("maps resolved, uncertain, conflict and incompatible states to deterministic German text", () => {
    expect(
      technicalFieldStatusText({
        field: "nozzleDiameter",
        status: "resolved",
        reasonCode: "single_claim",
        value: 0.6,
        unit: "mm",
      })
    ).toBe("Bestätigt: 0,6 mm");
    expect(
      technicalFieldStatusText({
        field: "nozzleDiameter",
        status: "blocked",
        reasonCode: "insufficient_confirmation",
        unit: "mm",
      })
    ).toBe("Noch nicht bestätigt");
    expect(
      technicalFieldStatusText({
        field: "extruderType",
        status: "conflict",
        reasonCode: "unresolved_conflict",
      })
    ).toBe("Widersprüchliche Angaben");
    expect(
      technicalFieldStatusText({
        field: "extruderType",
        status: "blocked",
        reasonCode: "incompatible_claim_representations",
      })
    ).toBe("Die gespeicherten Angaben sind nicht kompatibel.");
  });
});
