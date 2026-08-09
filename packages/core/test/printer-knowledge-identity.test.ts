import { describe, expect, it } from "vitest";

import * as core from "../src/index.js";
import {
  InvalidPrinterKnowledgeDefinitionReferenceError,
  InvalidPrinterKnowledgeDisplaySnapshotError,
  InvalidPrinterKnowledgeIdentityIdError,
  InvalidPrinterKnowledgeIdentityKindError,
  InvalidPrinterKnowledgeIdentityPrinterIdError,
  InvalidPrinterKnowledgeIdentityShapeError,
  InvalidPrinterKnowledgeIdentityTimestampError,
  InvalidPrinterKnowledgeModelPairingError,
  createPrinterKnowledgeIdentity,
  type CreatePrinterKnowledgeIdentityInput,
} from "../src/printer-knowledge-identity.js";

const SELECTED_AT = "2026-08-09T12:00:00.123Z";
const SERIES_REFERENCE = {
  packageId: "printer-series.example",
  packageVersion: "release-opaque+1",
  seriesDefinitionId: "series-a",
};
const MODEL_REFERENCE = { ...SERIES_REFERENCE, modelDefinitionId: "model-pro" };

function knownInput(
  overrides: Partial<Extract<CreatePrinterKnowledgeIdentityInput, { kind: "known" }>> = {}
): Extract<CreatePrinterKnowledgeIdentityInput, { kind: "known" }> {
  return {
    id: "identity-a",
    printerId: "printer-1",
    kind: "known",
    definitionRef: MODEL_REFERENCE,
    manufacturerDisplayName: "Example Machines",
    seriesDisplayName: "Series A",
    modelDisplayName: "Model Pro",
    selectedAt: SELECTED_AT,
    ...overrides,
  };
}

describe("PrinterKnowledgeIdentity", () => {
  it("creates a deeply frozen exact-model identity retaining exact package identity and display snapshot", () => {
    const identity = createPrinterKnowledgeIdentity(knownInput());
    expect(identity).toEqual({
      id: "identity-a",
      printerId: "printer-1",
      kind: "known",
      definitionRef: MODEL_REFERENCE,
      manufacturerDisplayName: "Example Machines",
      seriesDisplayName: "Series A",
      modelDisplayName: "Model Pro",
      selectedAt: SELECTED_AT,
    });
    expect(Object.isFrozen(identity)).toBe(true);
    expect(identity.kind === "known" && Object.isFrozen(identity.definitionRef)).toBe(true);
  });

  it("creates a valid series-level identity with both model fields absent", () => {
    const input = knownInput({ definitionRef: SERIES_REFERENCE });
    delete (input as { modelDisplayName?: string }).modelDisplayName;
    const identity = createPrinterKnowledgeIdentity(input);
    expect(identity).not.toHaveProperty("modelDisplayName");
    expect(identity.kind === "known" && identity.definitionRef).not.toHaveProperty(
      "modelDefinitionId"
    );
  });

  it("creates an unclassified identity belonging only to its Printer", () => {
    expect(
      createPrinterKnowledgeIdentity({
        id: "identity-custom",
        printerId: "printer-custom",
        kind: "unclassified",
        selectedAt: SELECTED_AT,
      })
    ).toEqual({
      id: "identity-custom",
      printerId: "printer-custom",
      kind: "unclassified",
      selectedAt: SELECTED_AT,
    });
  });

  it.each([
    [MODEL_REFERENCE, undefined],
    [SERIES_REFERENCE, "Model Pro"],
  ] as const)(
    "rejects a partial model pairing for reference %j and display %j",
    (definitionRef, modelDisplayName) => {
      const input = knownInput({ definitionRef });
      if (modelDisplayName === undefined) {
        delete (input as { modelDisplayName?: string }).modelDisplayName;
      } else {
        (input as { modelDisplayName: string }).modelDisplayName = modelDisplayName;
      }
      expect(() => createPrinterKnowledgeIdentity(input)).toThrow(
        InvalidPrinterKnowledgeModelPairingError
      );
    }
  );

  it.each(["", " ", " identity", "identity "])("rejects invalid identity ID %j", (id) => {
    expect(() => createPrinterKnowledgeIdentity(knownInput({ id }))).toThrow(
      InvalidPrinterKnowledgeIdentityIdError
    );
  });

  it.each(["", " ", " printer-1", "printer-1 "])("rejects invalid Printer ID %j", (printerId) => {
    expect(() => createPrinterKnowledgeIdentity(knownInput({ printerId }))).toThrow(
      InvalidPrinterKnowledgeIdentityPrinterIdError
    );
  });

  it("rejects unsupported kinds", () => {
    expect(() =>
      createPrinterKnowledgeIdentity({ ...knownInput(), kind: "suggested" } as never)
    ).toThrow(InvalidPrinterKnowledgeIdentityKindError);
  });

  it.each([
    { ...MODEL_REFERENCE, packageId: "" },
    { ...MODEL_REFERENCE, packageVersion: " version" },
    { ...MODEL_REFERENCE, seriesDefinitionId: "series " },
    { ...MODEL_REFERENCE, modelDefinitionId: "" },
    { ...MODEL_REFERENCE, latest: true },
    null,
  ])("rejects malformed package reference %j", (definitionRef) => {
    expect(() => createPrinterKnowledgeIdentity(knownInput({ definitionRef } as never))).toThrow(
      InvalidPrinterKnowledgeDefinitionReferenceError
    );
  });

  it.each(["manufacturerDisplayName", "seriesDisplayName", "modelDisplayName"] as const)(
    "rejects empty or whitespace-padded %s without normalizing",
    (field) => {
      for (const value of ["", " ", " padded", "padded "]) {
        expect(() => createPrinterKnowledgeIdentity(knownInput({ [field]: value }))).toThrow(
          InvalidPrinterKnowledgeDisplaySnapshotError
        );
      }
    }
  );

  it.each([
    "not-a-date",
    "2026-08-09T12:00:00+00:00",
    "2026-02-30T12:00:00Z",
    "2025-02-29T12:00:00Z",
  ])("rejects invalid selectedAt %s", (selectedAt) => {
    expect(() => createPrinterKnowledgeIdentity(knownInput({ selectedAt }))).toThrow(
      InvalidPrinterKnowledgeIdentityTimestampError
    );
  });

  it("accepts valid approved UTC syntax including a real leap day", () => {
    expect(
      createPrinterKnowledgeIdentity(knownInput({ selectedAt: "2024-02-29T12:00:00Z" })).selectedAt
    ).toBe("2024-02-29T12:00:00Z");
  });

  it.each(["v1", "2026.08-custom", "not-semver", "latest"])(
    "treats package version %j as an opaque exact identifier",
    (packageVersion) => {
      const identity = createPrinterKnowledgeIdentity(
        knownInput({ definitionRef: { ...MODEL_REFERENCE, packageVersion } })
      );
      expect(identity.kind === "known" && identity.definitionRef.packageVersion).toBe(
        packageVersion
      );
    }
  );

  it("defensively copies caller-owned reference objects", () => {
    const definitionRef = { ...MODEL_REFERENCE };
    const identity = createPrinterKnowledgeIdentity(knownInput({ definitionRef }));
    definitionRef.modelDefinitionId = "changed";
    expect(identity.kind === "known" && identity.definitionRef.modelDefinitionId).toBe("model-pro");
    expect(identity.kind === "known" && identity.definitionRef).not.toBe(definitionRef);
  });

  it("allows independent correction records for one Printer without selecting a current one", () => {
    const first = createPrinterKnowledgeIdentity(knownInput({ id: "identity-first" }));
    const second = createPrinterKnowledgeIdentity(
      knownInput({
        id: "identity-correction",
        definitionRef: { ...MODEL_REFERENCE, modelDefinitionId: "model-plus" },
        modelDisplayName: "Model Plus",
      })
    );
    expect(first.printerId).toBe(second.printerId);
    expect(first).not.toEqual(second);
    expect(first).not.toHaveProperty("active");
    expect(second).not.toHaveProperty("supersededBy");
  });

  it("rejects package data on unclassified records", () => {
    expect(() =>
      createPrinterKnowledgeIdentity({
        id: "identity-custom",
        printerId: "printer-custom",
        kind: "unclassified",
        selectedAt: SELECTED_AT,
        definitionRef: SERIES_REFERENCE,
      } as never)
    ).toThrow(InvalidPrinterKnowledgeIdentityShapeError);
  });

  it("exports no update or current-selection operation", () => {
    expect(core).not.toHaveProperty("updatePrinterKnowledgeIdentity");
    expect(core).not.toHaveProperty("selectCurrentPrinterKnowledgeIdentity");
  });
});
