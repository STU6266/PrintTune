import type { InstalledKnowledgePackage } from "@printtune/contracts";
import { describe, expect, it } from "vitest";

import {
  InvalidInstalledKnowledgePackageError,
  InvalidKnowledgePackageSourceTrustPairError,
  createInstalledKnowledgePackage,
} from "../src/index.js";

const DIGEST = "a".repeat(64);
const INSTALLED_AT = "2026-08-09T12:00:00.123Z";

function record(overrides: Partial<InstalledKnowledgePackage> = {}): InstalledKnowledgePackage {
  return {
    packageId: "example.synthetic-package",
    packageVersion: "release/opaque+1",
    formatVersion: 1,
    packageType: "printer_series",
    rawText: '  {\n  "synthetic": true\n}\n',
    contentSha256: DIGEST,
    installationSource: "bundled_official",
    trust: "developer_verified",
    installedAt: INSTALLED_AT,
    ...overrides,
  };
}

describe("InstalledKnowledgePackage", () => {
  it("preserves exact raw text and returns an immutable accepted record", () => {
    const input = record();
    const installed = createInstalledKnowledgePackage(input);
    expect(installed).toEqual(input);
    expect(installed.rawText).toBe('  {\n  "synthetic": true\n}\n');
    expect(Object.isFrozen(installed)).toBe(true);
  });

  it.each([
    ["packageId", { packageId: " package" }],
    ["packageVersion", { packageVersion: "" }],
    ["formatVersion", { formatVersion: 2 }],
    ["packageType", { packageType: "component_catalog" }],
    ["rawText", { rawText: "" }],
    ["contentSha256", { contentSha256: "A".repeat(64) }],
    ["contentSha256", { contentSha256: `${"a".repeat(63)}g` }],
    ["installedAt", { installedAt: "2026-02-30T10:00:00Z" }],
  ] as const)("rejects invalid %s", (_field, overrides) => {
    expect(() => createInstalledKnowledgePackage({ ...record(), ...overrides } as never)).toThrow(
      InvalidInstalledKnowledgePackageError
    );
  });

  it.each([
    ["bundled_official", "customer_verified"],
    ["customer_verified_installation", "developer_verified"],
    ["manual_import", "customer_verified"],
  ])("rejects source/trust pair %s → %s", (installationSource, trust) => {
    expect(() =>
      createInstalledKnowledgePackage({ ...record(), installationSource, trust } as never)
    ).toThrow(InvalidKnowledgePackageSourceTrustPairError);
  });

  it("does not parse raw package text or calculate/verify its supplied digest", () => {
    expect(
      createInstalledKnowledgePackage({ ...record(), rawText: "not JSON", contentSha256: DIGEST })
    ).toMatchObject({ rawText: "not JSON", contentSha256: DIGEST });
  });
});
