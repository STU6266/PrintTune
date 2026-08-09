import type { InstalledKnowledgePackage } from "@printtune/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ImmutableKnowledgePackageCollisionError,
  InstalledKnowledgePackageMetadataConflictError,
  type InstalledKnowledgePackageRepository,
} from "../src/index";

export const FIRST_INSTALLED_AT = "2026-08-09T10:00:00.000Z";
export const SECOND_INSTALLED_AT = "2026-08-10T10:00:00.000Z";
export const FIRST_DIGEST = "a".repeat(64);

export function installedPackage(
  overrides: Partial<InstalledKnowledgePackage> = {}
): InstalledKnowledgePackage {
  return {
    packageId: "package-b",
    packageVersion: "1.0",
    formatVersion: 1,
    packageType: "printer_series",
    rawText: '  {\n  "fixture": true\n}\n',
    contentSha256: FIRST_DIGEST,
    installationSource: "bundled_official",
    trust: "developer_verified",
    installedAt: FIRST_INSTALLED_AT,
    ...overrides,
  };
}

export interface InstalledKnowledgePackageRepositoryFixture {
  readonly repository: InstalledKnowledgePackageRepository;
  readonly close: () => void | Promise<void>;
}

export function describeInstalledKnowledgePackageRepository(
  name: string,
  createFixture: () =>
    InstalledKnowledgePackageRepositoryFixture | Promise<InstalledKnowledgePackageRepositoryFixture>
): void {
  describe(name, () => {
    let fixture: InstalledKnowledgePackageRepositoryFixture;

    beforeEach(async () => {
      fixture = await createFixture();
    });
    afterEach(async () => fixture.close());

    it("starts empty and uses exact lookup", async () => {
      await expect(fixture.repository.findExact("missing", "1.0")).resolves.toBeUndefined();
      await expect(fixture.repository.list()).resolves.toEqual([]);
    });

    it("accepts and retrieves the exact immutable record", async () => {
      const value = installedPackage();
      await expect(fixture.repository.accept(value)).resolves.toBe("installed");
      const found = await fixture.repository.findExact(value.packageId, value.packageVersion);
      expect(found).toEqual(value);
      expect(Object.isFrozen(found)).toBe(true);
    });

    it("treats an exact reinstall as idempotent and preserves original installedAt", async () => {
      const value = installedPackage();
      await fixture.repository.accept(value);
      await expect(
        fixture.repository.accept({ ...value, installedAt: SECOND_INSTALLED_AT })
      ).resolves.toBe("already_installed");
      await expect(
        fixture.repository.findExact(value.packageId, value.packageVersion)
      ).resolves.toEqual(value);
      expect(await fixture.repository.list()).toHaveLength(1);
    });

    it("keeps different opaque versions and lists lexically by package ID then version", async () => {
      const values = [
        installedPackage({ packageId: "package-b", packageVersion: "1.2" }),
        installedPackage({ packageId: "package-a", packageVersion: "release-a" }),
        installedPackage({ packageId: "package-b", packageVersion: "1.10" }),
      ];
      for (const value of values) await fixture.repository.accept(value);
      expect(
        (await fixture.repository.list()).map(({ packageId, packageVersion }) => [
          packageId,
          packageVersion,
        ])
      ).toEqual([
        ["package-a", "release-a"],
        ["package-b", "1.10"],
        ["package-b", "1.2"],
      ]);
      await expect(fixture.repository.findExact("package-b", "1.1")).resolves.toBeUndefined();
    });

    it("rejects different exact raw text even when the supplied digest matches", async () => {
      const original = installedPackage();
      await fixture.repository.accept(original);
      await expect(
        fixture.repository.accept({ ...original, rawText: `${original.rawText} ` })
      ).rejects.toBeInstanceOf(ImmutableKnowledgePackageCollisionError);
      await expect(
        fixture.repository.findExact(original.packageId, original.packageVersion)
      ).resolves.toEqual(original);
    });

    it("rejects a different supplied digest as an immutable content collision", async () => {
      const original = installedPackage();
      await fixture.repository.accept(original);
      await expect(
        fixture.repository.accept({ ...original, contentSha256: "b".repeat(64) })
      ).rejects.toBeInstanceOf(ImmutableKnowledgePackageCollisionError);
    });

    it("rejects source/trust metadata changes without rewriting the record", async () => {
      const original = installedPackage();
      await fixture.repository.accept(original);
      await expect(
        fixture.repository.accept({
          ...original,
          installationSource: "customer_verified_installation",
          trust: "customer_verified",
        })
      ).rejects.toBeInstanceOf(InstalledKnowledgePackageMetadataConflictError);
      await expect(
        fixture.repository.findExact(original.packageId, original.packageVersion)
      ).resolves.toEqual(original);
    });

    it("preserves exact raw text including surrounding whitespace", async () => {
      const value = installedPackage({ rawText: ' \n{"a": 1}\t ' });
      await fixture.repository.accept(value);
      await expect(
        fixture.repository.findExact(value.packageId, value.packageVersion)
      ).resolves.toMatchObject({
        rawText: value.rawText,
      });
    });

    it("defensively isolates stored state from mutable caller objects", async () => {
      const input = structuredClone(installedPackage()) as {
        rawText: string;
      } & InstalledKnowledgePackage;
      const expected = input.rawText;
      await fixture.repository.accept(input);
      input.rawText = "changed";
      const found = await fixture.repository.findExact(input.packageId, input.packageVersion);
      expect(found?.rawText).toBe(expected);
      expect(() => {
        (found as { rawText: string }).rawText = "changed again";
      }).toThrow();
      expect(Object.isFrozen(await fixture.repository.list())).toBe(true);
    });
  });
}
