import { describe, expect, it } from "vitest";

import {
  InvalidPackageApplicationError,
  createPackageApplication,
  createPackageApplicationKey,
  getPackageApplicationKey,
} from "../src/package-application";

const input = {
  id: "application-a",
  printerId: "printer-a",
  printerStateId: "state-a",
  printerKnowledgeIdentityId: "identity-a",
  packageId: "package-a",
  packageVersion: "release opaque",
  seriesDefinitionId: "series-a",
  modelDefinitionId: "model-a",
  coreContractVersion: "0.9.0",
  packageTrust: "developer_verified" as const,
  timestamp: "2026-08-10T10:00:00Z",
};

describe("PackageApplication", () => {
  it("creates an immutable historical application and exact semantic key", () => {
    const application = createPackageApplication(input);
    const { timestamp, ...fields } = input;
    expect(application).toEqual({ ...fields, appliedAt: timestamp });
    expect(application).not.toHaveProperty("timestamp");
    expect(Object.isFrozen(application)).toBe(true);
    expect(getPackageApplicationKey(application)).toEqual({
      printerStateId: "state-a",
      packageId: "package-a",
      packageVersion: "release opaque",
      seriesDefinitionId: "series-a",
      modelDefinitionId: "model-a",
      coreContractVersion: "0.9.0",
    });
  });

  it.each([
    ["id", " application-a"],
    ["packageVersion", ""],
    ["modelDefinitionId", " "],
    ["coreContractVersion", "1.0"],
    ["packageTrust", "unverified"],
    ["timestamp", "2026-02-30T10:00:00Z"],
  ])("rejects invalid %s", (field, value) => {
    expect(() => createPackageApplication({ ...input, [field]: value })).toThrow(
      InvalidPackageApplicationError
    );
  });

  it("supports a series-only key without an undefined property", () => {
    const key = createPackageApplicationKey({
      printerStateId: "state-a",
      packageId: "package-a",
      packageVersion: "1",
      seriesDefinitionId: "series-a",
      coreContractVersion: "1.0.0",
    });
    expect(Object.keys(key)).not.toContain("modelDefinitionId");
  });
});
