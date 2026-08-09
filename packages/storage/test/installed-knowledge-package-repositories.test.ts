import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  InMemoryInstalledKnowledgePackageRepository,
  InstalledKnowledgePackageDataIntegrityError,
  openPrintTuneDatabase,
} from "../src/index";
import { parseInstalledKnowledgePackageRow } from "../src/sqlite-installed-knowledge-package-repository";
import {
  FIRST_INSTALLED_AT,
  SECOND_INSTALLED_AT,
  describeInstalledKnowledgePackageRepository,
  installedPackage,
} from "./installed-knowledge-package-repository-contract";

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "printtune-installed-packages-"));
  return { directory, path: join(directory, "printtune.sqlite") };
}

describeInstalledKnowledgePackageRepository("InMemoryInstalledKnowledgePackageRepository", () => ({
  repository: new InMemoryInstalledKnowledgePackageRepository(),
  close() {},
}));

describeInstalledKnowledgePackageRepository("SqliteInstalledKnowledgePackageRepository", () => {
  const database = openPrintTuneDatabase(":memory:");
  database.migrate();
  return {
    repository: database.createInstalledKnowledgePackageRepository(),
    close: () => database.close(),
  };
});

describe("SQLite installed Knowledge Package persistence and integrity", () => {
  it("preserves the original installation and timestamp across close/reopen", async () => {
    const { directory, path } = temporaryDatabase();
    try {
      const value = installedPackage();
      const first = openPrintTuneDatabase(path);
      first.migrate();
      await first.createInstalledKnowledgePackageRepository().accept(value);
      first.close();

      const second = openPrintTuneDatabase(path);
      second.migrate();
      const repository = second.createInstalledKnowledgePackageRepository();
      await expect(repository.accept({ ...value, installedAt: SECOND_INSTALLED_AT })).resolves.toBe(
        "already_installed"
      );
      await expect(
        repository.findExact(value.packageId, value.packageVersion)
      ).resolves.toMatchObject({
        installedAt: FIRST_INSTALLED_AT,
      });
      second.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["package_id", 42],
    ["package_version", null],
    ["format_version", "1"],
    ["package_type", "component_catalog"],
    ["raw_text", ""],
    ["content_sha256", "g".repeat(64)],
    ["installation_source", "manual_import"],
    ["trust", "user_entered"],
    ["installed_at", "2026-02-30T10:00:00Z"],
  ])("rejects malformed reconstructed %s", (field, invalid) => {
    const row: Record<string, unknown> = {
      package_id: "package-a",
      package_version: "1.0",
      format_version: 1,
      package_type: "printer_series",
      raw_text: "{}",
      content_sha256: "a".repeat(64),
      installation_source: "bundled_official",
      trust: "developer_verified",
      installed_at: FIRST_INSTALLED_AT,
    };
    row[field] = invalid;
    expect(() => parseInstalledKnowledgePackageRow(row)).toThrow(
      InstalledKnowledgePackageDataIntegrityError
    );
  });
});
