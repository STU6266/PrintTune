import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { FieldClaim, PackageApplication } from "@printtune/contracts";
import { createFieldClaim, createPackageApplication } from "@printtune/core";
import { afterEach, describe, expect, it } from "vitest";

import { DuplicateFieldClaimError } from "../src/field-claim-repository";
import { InMemoryPackageApplicationPersistence } from "../src/in-memory-package-application-persistence";
import {
  InvalidPackageApplicationBatchError,
  PackageApplicationMetadataConflictError,
} from "../src/package-application-lifecycle-persistence";
import { openPrintTuneDatabase } from "../src/printtune-database";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function application(overrides: Partial<PackageApplication> = {}): PackageApplication {
  const { appliedAt = "2026-08-10T10:00:00Z", ...fields } = overrides;
  return createPackageApplication({
    id: "application-a",
    printerId: "printer-a",
    printerStateId: "state-a",
    printerKnowledgeIdentityId: "identity-a",
    packageId: "package-a",
    packageVersion: "1.0.0",
    seriesDefinitionId: "series-a",
    modelDefinitionId: "model-a",
    coreContractVersion: "1.0.0",
    packageTrust: "developer_verified",
    timestamp: appliedAt,
    ...fields,
  });
}

function claim(id: string, app = application()): FieldClaim {
  return createFieldClaim({
    id,
    target: { type: "printer_state", printerStateId: app.printerStateId },
    fieldPath: "printer.nozzle.diameter",
    value: { type: "number", value: 0.4 },
    unit: "mm",
    provenance: {
      sourceType: "knowledge_package",
      sourceRef: {
        type: "knowledge_package",
        packageId: app.packageId,
        packageVersion: app.packageVersion,
        factId: `fact-${id}`,
      },
    },
    trust: app.packageTrust,
    timestamp: app.appliedAt,
  });
}

async function seed(database: ReturnType<typeof openPrintTuneDatabase>): Promise<void> {
  await database.createWorkspaceRepository().save({
    id: "workspace-a",
    name: "Workspace",
    createdAt: "2026-08-10T09:00:00Z",
    updatedAt: "2026-08-10T09:00:00Z",
  });
  await database.createPrinterRepository().save({
    id: "printer-a",
    workspaceId: "workspace-a",
    name: "Printer",
    createdAt: "2026-08-10T09:00:00Z",
    updatedAt: "2026-08-10T09:00:00Z",
  });
  await database.createPrinterStateRepository().create({
    id: "state-a",
    printerId: "printer-a",
    createdAt: "2026-08-10T09:00:00Z",
  });
  const identities = database.createPrinterKnowledgeIdentityRepository();
  await identities.create({
    id: "identity-a",
    printerId: "printer-a",
    kind: "unclassified",
    selectedAt: "2026-08-10T09:00:00Z",
  });
  await identities.create({
    id: "identity-b",
    printerId: "printer-a",
    kind: "unclassified",
    selectedAt: "2026-08-10T09:01:00Z",
  });
}

describe("InMemory PackageApplication apply-once lifecycle", () => {
  it("atomically applies, preserves Claim order, and deduplicates before Claim collisions", async () => {
    const store = new InMemoryPackageApplicationPersistence();
    const first = application();
    expect(await store.applyOnce(first, [claim("claim-b"), claim("claim-a")])).toEqual({
      status: "applied",
      application: first,
    });
    expect(await store.listClaimIds(first.id)).toEqual(["claim-b", "claim-a"]);

    const retry = application({
      id: "application-retry",
      printerKnowledgeIdentityId: "identity-b",
      appliedAt: "2026-08-11T10:00:00Z",
    });
    expect(await store.applyOnce(retry, [claim("claim-a", retry)])).toEqual({
      status: "already_applied",
      application: first,
    });
    expect(await store.listClaimIds(first.id)).toEqual(["claim-b", "claim-a"]);
  });

  it("rejects invalid batches and trust conflicts without mutation", async () => {
    const store = new InMemoryPackageApplicationPersistence();
    const first = application();
    await expect(store.applyOnce(first, [claim("duplicate"), claim("duplicate")])).rejects.toThrow(
      InvalidPackageApplicationBatchError
    );
    expect(await store.listForPrinterState(first.printerStateId)).toEqual([]);
    await store.applyOnce(first, []);
    await expect(
      store.applyOnce(application({ id: "other", packageTrust: "customer_verified" }), [])
    ).rejects.toThrow(PackageApplicationMetadataConflictError);
  });
});

describe("SQLite PackageApplication apply-once lifecycle", () => {
  it("persists one atomic batch, exact membership, historical contracts, and restart reads", async () => {
    const directory = mkdtempSync(join(tmpdir(), "printtune-package-application-"));
    directories.push(directory);
    const path = join(directory, "database.sqlite");
    const firstDatabase = openPrintTuneDatabase(path);
    firstDatabase.migrate();
    await seed(firstDatabase);
    const first = application({ coreContractVersion: "0.9.0" });
    const lifecycle = firstDatabase.createPackageApplicationLifecyclePersistence();
    expect(
      (await lifecycle.applyOnce(first, [claim("claim-b", first), claim("claim-a", first)])).status
    ).toBe("applied");
    expect(await firstDatabase.createPackageApplicationRepository().listClaimIds(first.id)).toEqual(
      ["claim-b", "claim-a"]
    );
    firstDatabase.close();

    const secondDatabase = openPrintTuneDatabase(path);
    secondDatabase.migrate();
    const repository = secondDatabase.createPackageApplicationRepository();
    expect(await repository.findById(first.id)).toEqual(first);
    expect(await secondDatabase.createFieldClaimRepository().findById("claim-a")).toEqual(
      claim("claim-a", first)
    );
    secondDatabase.close();
  });

  it("returns the first identity application and rejects conflicting trust", async () => {
    const database = openPrintTuneDatabase(":memory:");
    database.migrate();
    await seed(database);
    const lifecycle = database.createPackageApplicationLifecyclePersistence();
    const first = application();
    await lifecycle.applyOnce(first, []);
    const retry = application({
      id: "application-b",
      printerKnowledgeIdentityId: "identity-b",
      appliedAt: "2026-08-11T10:00:00Z",
    });
    expect(
      await database.createPackageApplicationLifecyclePersistence().applyOnce(retry, [])
    ).toEqual({
      status: "already_applied",
      application: first,
    });
    await expect(
      lifecycle.applyOnce(
        application({ id: "application-c", packageTrust: "customer_verified" }),
        []
      )
    ).rejects.toThrow(PackageApplicationMetadataConflictError);
    database.close();
  });

  it("rolls back the application when a generated Claim ID already exists", async () => {
    const database = openPrintTuneDatabase(":memory:");
    database.migrate();
    await seed(database);
    const existing = claim("collision");
    await database.createFieldClaimRepository().create(existing);
    await expect(
      database.createPackageApplicationLifecyclePersistence().applyOnce(application(), [existing])
    ).rejects.toThrow(DuplicateFieldClaimError);
    expect(
      await database.createPackageApplicationRepository().findById("application-a")
    ).toBeUndefined();
    expect(await database.createFieldClaimRepository().findById("collision")).toEqual(existing);
    database.close();
  });

  it("rolls back application, Claims, and links after a late junction failure", async () => {
    const directory = mkdtempSync(join(tmpdir(), "printtune-package-rollback-"));
    directories.push(directory);
    const path = join(directory, "database.sqlite");
    const setup = openPrintTuneDatabase(path);
    setup.migrate();
    await seed(setup);
    setup.close();
    const triggerConnection = new DatabaseSync(path);
    triggerConnection.exec(`
      CREATE TRIGGER reject_second_application_claim
      BEFORE INSERT ON package_application_claims
      WHEN NEW.claim_order = 1
      BEGIN
        SELECT RAISE(ABORT, 'synthetic late link failure');
      END
    `);
    triggerConnection.close();

    const database = openPrintTuneDatabase(path);
    const first = application();
    await expect(
      database
        .createPackageApplicationLifecyclePersistence()
        .applyOnce(first, [claim("late-a"), claim("late-b")])
    ).rejects.toThrow("synthetic late link failure");
    expect(await database.createPackageApplicationRepository().findById(first.id)).toBeUndefined();
    expect(await database.createFieldClaimRepository().findById("late-a")).toBeUndefined();
    expect(await database.createFieldClaimRepository().findById("late-b")).toBeUndefined();
    database.close();
  });
});
