import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  InstalledKnowledgePackage,
  PrinterSeriesKnowledgePackageV1,
} from "@printtune/contracts";
import {
  createInstalledKnowledgePackage,
  createPrinter,
  createPrinterKnowledgeIdentity,
  createPrinterState,
  createWorkspace,
} from "@printtune/core";
import {
  ImmutableKnowledgePackageCollisionError,
  InMemoryInstalledKnowledgePackageRepository,
  InstalledKnowledgePackageMetadataConflictError,
  openPrintTuneDatabase,
  type InstalledKnowledgePackageRepository,
} from "@printtune/storage";
import { describe, expect, it, vi } from "vitest";

import { ActiveWorkspaceSession } from "../src/main/active-workspace-session";
import { FieldResolutionService } from "../src/main/field-resolution-service";
import { InstalledKnowledgePackageSource } from "../src/main/installed-knowledge-package-source";
import {
  KnowledgePackageInstallationError,
  KnowledgePackageInstallationService,
} from "../src/main/knowledge-package-installation-service";
import { computeKnowledgePackageSha256 } from "../src/main/knowledge-package-sha256";
import { PrinterKnowledgeApplicationService } from "../src/main/printer-knowledge-application-service";

const INSTALLED_AT = "2026-08-09T10:00:00.000Z";
const REINSTALL_AT = "2026-08-10T10:00:00.000Z";
const TARGET = { type: "printer_state", printerStateId: "state-a" } as const;

function syntheticPackage(
  overrides: {
    packageVersion?: string;
    displayName?: string;
    publisherDisplayName?: string;
    incompatible?: boolean;
    minimumCoreVersion?: string;
    maximumCoreVersionExclusive?: string | null;
  } = {}
): PrinterSeriesKnowledgePackageV1 {
  return {
    formatVersion: 1,
    packageId: "example.synthetic-installed-package",
    packageVersion: overrides.packageVersion ?? "1.0",
    packageType: "printer_series",
    displayName: overrides.displayName ?? "Synthetic Installed Series",
    publisher: {
      publisherId: "example.synthetic-publisher",
      publisherDisplayName: overrides.publisherDisplayName ?? "Synthetic Publisher",
    },
    coreCompatibility: {
      minimumVersion: overrides.minimumCoreVersion ?? "1.0.0",
      ...(overrides.maximumCoreVersionExclusive === null
        ? {}
        : { maximumVersionExclusive: overrides.maximumCoreVersionExclusive ?? "2.0.0" }),
    },
    payload: {
      series: {
        seriesDefinitionId: "synthetic-series",
        manufacturerDisplayName: "Synthetic Manufacturer",
        seriesDisplayName: "Synthetic Series",
        facts: [
          {
            factId: "series-nozzle",
            fieldPath: "printer.nozzle.diameter",
            value: { type: "number", value: 0.4 },
            unit: "mm",
          },
          {
            factId: "series-extruder",
            fieldPath: overrides.incompatible
              ? "printer.synthetic.unknown"
              : "printer.extruder.type",
            value: { type: "string", value: "synthetic-extruder" },
          },
        ],
        models: [
          {
            modelDefinitionId: "synthetic-model",
            modelDisplayName: "Synthetic Model",
            facts: [
              {
                factId: "model-nozzle",
                fieldPath: "printer.nozzle.diameter",
                value: { type: "number", value: 0.6 },
                unit: "mm",
              },
            ],
          },
        ],
      },
    },
  };
}

function packageText(
  overrides: Parameters<typeof syntheticPackage>[0] = {},
  indentation?: number
): string {
  return JSON.stringify(syntheticPackage(overrides), null, indentation);
}

function sourceRecord(
  overrides: Partial<InstalledKnowledgePackage> = {}
): InstalledKnowledgePackage {
  const rawText = packageText();
  return createInstalledKnowledgePackage({
    packageId: "example.synthetic-installed-package",
    packageVersion: "1.0",
    formatVersion: 1,
    packageType: "printer_series",
    rawText,
    contentSha256: computeKnowledgePackageSha256(rawText),
    installationSource: "bundled_official",
    trust: "developer_verified",
    installedAt: INSTALLED_AT,
    ...overrides,
  });
}

describe("KnowledgePackageInstallationService", () => {
  it.each([
    ["bundled_official", "developer_verified", "Manifest says customer"],
    ["customer_verified_installation", "customer_verified", "Manifest says official"],
  ] as const)(
    "derives %s trust as %s independently of publisher metadata",
    async (source, trust, publisherDisplayName) => {
      const repository = new InMemoryInstalledKnowledgePackageRepository();
      const rawText = packageText({ publisherDisplayName }, 2);
      const service = new KnowledgePackageInstallationService(repository, {
        now: () => INSTALLED_AT,
      });

      await expect(
        service.installTrustedPackage({ rawText, installationSource: source })
      ).resolves.toEqual({
        status: "installed",
        packageId: "example.synthetic-installed-package",
        packageVersion: "1.0",
        contentSha256: computeKnowledgePackageSha256(rawText),
      });
      await expect(
        repository.findExact("example.synthetic-installed-package", "1.0")
      ).resolves.toMatchObject({
        rawText,
        installationSource: source,
        trust,
        installedAt: INSTALLED_AT,
      });
    }
  );

  it("computes standard lowercase SHA-256 over exact UTF-8 without canonicalization", () => {
    expect(computeKnowledgePackageSha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(computeKnowledgePackageSha256(packageText({}, 2))).not.toBe(
      computeKnowledgePackageSha256(packageText())
    );
    expect(computeKnowledgePackageSha256("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["malformed", "{", "invalid_package"],
    ["structurally invalid", "{}", "invalid_package"],
    ["Core-incompatible", packageText({ incompatible: true }), "incompatible_package"],
  ])(
    "rejects a %s candidate before clock use or repository acceptance",
    async (_label, rawText, code) => {
      const repository = new InMemoryInstalledKnowledgePackageRepository();
      const accept = vi.spyOn(repository, "accept");
      const now = vi.fn(() => INSTALLED_AT);
      const service = new KnowledgePackageInstallationService(repository, { now });
      await expect(
        service.installTrustedPackage({ rawText, installationSource: "bundled_official" })
      ).rejects.toMatchObject({ code });
      expect(now).not.toHaveBeenCalled();
      expect(accept).not.toHaveBeenCalled();
      await expect(repository.list()).resolves.toEqual([]);
    }
  );

  it("rejects an invalid runtime installation source before clock or persistence", async () => {
    const repository = new InMemoryInstalledKnowledgePackageRepository();
    const accept = vi.spyOn(repository, "accept");
    const now = vi.fn(() => INSTALLED_AT);
    const service = new KnowledgePackageInstallationService(repository, { now });
    await expect(
      service.installTrustedPackage({
        rawText: packageText(),
        installationSource: "manual_import",
      } as never)
    ).rejects.toEqual(
      expect.objectContaining<Partial<KnowledgePackageInstallationError>>({
        code: "invalid_installation_source",
      })
    );
    expect(now).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
  });

  it.each([
    ["future minimum", { minimumCoreVersion: "999.0.0", maximumCoreVersionExclusive: null }],
    [
      "exclusive upper bound equal to current",
      { minimumCoreVersion: "0.1.0", maximumCoreVersionExclusive: "1.0.0" },
    ],
  ] as const)("rejects %s before clock use or repository acceptance", async (_label, overrides) => {
    const repository = new InMemoryInstalledKnowledgePackageRepository();
    const accept = vi.spyOn(repository, "accept");
    const now = vi.fn(() => INSTALLED_AT);
    const service = new KnowledgePackageInstallationService(repository, { now });

    await expect(
      service.installTrustedPackage({
        rawText: packageText(overrides),
        installationSource: "bundled_official",
      })
    ).rejects.toMatchObject({ code: "incompatible_package" });
    expect(now).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("keeps exact reinstall idempotent and preserves the original installedAt", async () => {
    const repository = new InMemoryInstalledKnowledgePackageRepository();
    const times = [INSTALLED_AT, REINSTALL_AT];
    const service = new KnowledgePackageInstallationService(repository, {
      now: () => times.shift() ?? REINSTALL_AT,
    });
    const input = { rawText: packageText(), installationSource: "bundled_official" } as const;
    await expect(service.installTrustedPackage(input)).resolves.toMatchObject({
      status: "installed",
    });
    await expect(service.installTrustedPackage(input)).resolves.toMatchObject({
      status: "already_installed",
    });
    await expect(
      repository.findExact("example.synthetic-installed-package", "1.0")
    ).resolves.toMatchObject({
      installedAt: INSTALLED_AT,
    });
  });

  it("preserves existing data on immutable content and local metadata conflicts", async () => {
    const repository = new InMemoryInstalledKnowledgePackageRepository();
    const service = new KnowledgePackageInstallationService(repository, {
      now: () => INSTALLED_AT,
    });
    const originalText = packageText();
    await service.installTrustedPackage({
      rawText: originalText,
      installationSource: "bundled_official",
    });

    await expect(
      service.installTrustedPackage({
        rawText: packageText({ displayName: "Changed but valid content" }),
        installationSource: "bundled_official",
      })
    ).rejects.toBeInstanceOf(ImmutableKnowledgePackageCollisionError);
    await expect(
      service.installTrustedPackage({
        rawText: originalText,
        installationSource: "customer_verified_installation",
      })
    ).rejects.toBeInstanceOf(InstalledKnowledgePackageMetadataConflictError);
    await expect(
      repository.findExact("example.synthetic-installed-package", "1.0")
    ).resolves.toMatchObject({
      rawText: originalText,
      installationSource: "bundled_official",
      trust: "developer_verified",
    });
  });

  it("keeps newer versions side-by-side without applying either package", async () => {
    const repository = new InMemoryInstalledKnowledgePackageRepository();
    const service = new KnowledgePackageInstallationService(repository, {
      now: () => INSTALLED_AT,
    });
    await service.installTrustedPackage({
      rawText: packageText(),
      installationSource: "bundled_official",
    });
    await service.installTrustedPackage({
      rawText: packageText({ packageVersion: "1.1" }),
      installationSource: "bundled_official",
    });
    expect((await repository.list()).map((value) => value.packageVersion)).toEqual(["1.0", "1.1"]);
  });
});

describe("InstalledKnowledgePackageSource", () => {
  it("returns undefined for missing exact versions and returns exact text/trust when found", async () => {
    const repository = new InMemoryInstalledKnowledgePackageRepository();
    const record = sourceRecord({ packageVersion: "1.1" });
    await repository.accept(record);
    const source = new InstalledKnowledgePackageSource(repository);
    await expect(
      source.getExactPackage({ packageId: record.packageId, packageVersion: "1.0" })
    ).resolves.toBeUndefined();
    await expect(
      source.getExactPackage({ packageId: record.packageId, packageVersion: "1.1" })
    ).resolves.toEqual({ text: record.rawText, trust: "developer_verified" });
  });

  it("treats latest as an exact opaque version without falling back", async () => {
    const repository = new InMemoryInstalledKnowledgePackageRepository();
    const installation = new KnowledgePackageInstallationService(repository, {
      now: () => INSTALLED_AT,
    });
    const source = new InstalledKnowledgePackageSource(repository);

    await installation.installTrustedPackage({
      rawText: packageText({ packageVersion: "1.0.0" }),
      installationSource: "bundled_official",
    });
    await expect(
      source.getExactPackage({
        packageId: "example.synthetic-installed-package",
        packageVersion: "latest",
      })
    ).resolves.toBeUndefined();

    const exactLatestText = packageText({ packageVersion: "latest" });
    await installation.installTrustedPackage({
      rawText: exactLatestText,
      installationSource: "bundled_official",
    });
    await expect(
      source.getExactPackage({
        packageId: "example.synthetic-installed-package",
        packageVersion: "latest",
      })
    ).resolves.toEqual({ text: exactLatestText, trust: "developer_verified" });
  });

  it.each([
    ["digest_mismatch", sourceRecord({ contentSha256: "a".repeat(64) })],
    [
      "invalid_record",
      {
        ...sourceRecord(),
        installationSource: "customer_verified_installation",
        trust: "developer_verified",
      } as InstalledKnowledgePackage,
    ],
  ] as const)("rejects found repository data with %s", async (reason, record) => {
    const repository: InstalledKnowledgePackageRepository = {
      accept: vi.fn(),
      findExact: vi.fn(async () => record),
      list: vi.fn(async () => []),
    };
    await expect(
      new InstalledKnowledgePackageSource(repository).getExactPackage({
        packageId: record.packageId,
        packageVersion: record.packageVersion,
      })
    ).rejects.toMatchObject({ name: "InstalledKnowledgePackageIntegrityError", reason });
  });
});

describe("durable installed Knowledge Package flow", () => {
  it("installs, restarts, applies model-effective Claims, and resolves through normal SQLite APIs", async () => {
    const directory = mkdtempSync(join(tmpdir(), "printtune-installed-package-flow-"));
    const path = join(directory, "printtune.sqlite");
    const rawText = packageText({}, 2);
    try {
      let database = openPrintTuneDatabase(path);
      database.migrate();
      const workspaces = database.createWorkspaceRepository();
      const printers = database.createPrinterRepository();
      const states = database.createPrinterStateRepository();
      const identities = database.createPrinterKnowledgeIdentityLifecyclePersistence();
      await workspaces.save(
        createWorkspace({ id: "workspace-a", name: "A", timestamp: INSTALLED_AT })
      );
      await printers.save(
        createPrinter({
          id: "printer-a",
          workspaceId: "workspace-a",
          name: "A",
          timestamp: INSTALLED_AT,
        })
      );
      await states.create(
        createPrinterState({ id: "state-a", printerId: "printer-a", timestamp: INSTALLED_AT })
      );
      await identities.createAndSelect(
        createPrinterKnowledgeIdentity({
          id: "identity-a",
          printerId: "printer-a",
          kind: "known",
          definitionRef: {
            packageId: "example.synthetic-installed-package",
            packageVersion: "1.0",
            seriesDefinitionId: "synthetic-series",
            modelDefinitionId: "synthetic-model",
          },
          manufacturerDisplayName: "Synthetic Manufacturer",
          seriesDisplayName: "Synthetic Series",
          modelDisplayName: "Synthetic Model",
          selectedAt: INSTALLED_AT,
        })
      );
      const installedRepository = database.createInstalledKnowledgePackageRepository();
      const installation = new KnowledgePackageInstallationService(installedRepository, {
        now: () => INSTALLED_AT,
      });
      await installation.installTrustedPackage({
        rawText,
        installationSource: "customer_verified_installation",
      });
      await expect(database.createFieldClaimRepository().listByTarget(TARGET)).resolves.toEqual([]);
      database.close();

      database = openPrintTuneDatabase(path);
      database.migrate();
      const reopenedPackages = database.createInstalledKnowledgePackageRepository();
      await expect(
        reopenedPackages.findExact("example.synthetic-installed-package", "1.0")
      ).resolves.toMatchObject({
        rawText,
        contentSha256: computeKnowledgePackageSha256(rawText),
        trust: "customer_verified",
      });
      const activeWorkspace = new ActiveWorkspaceSession(database.createWorkspaceRepository());
      await activeWorkspace.setActiveWorkspace("workspace-a");
      const claims = database.createFieldClaimRepository();
      const claimIds = ["claim-a", "claim-b"];
      const application = new PrinterKnowledgeApplicationService(
        database.createPrinterRepository(),
        database.createPrinterStateRepository(),
        database.createPrinterKnowledgeIdentityRepository(),
        database.createPrinterKnowledgeIdentitySelectionPersistence(),
        new InstalledKnowledgePackageSource(reopenedPackages),
        database.createPackageApplicationRepository(),
        database.createPackageApplicationLifecyclePersistence(),
        activeWorkspace,
        {
          createApplicationId: () => "package-application-a",
          createClaimId: () => claimIds.shift() ?? "unexpected",
          now: () => REINSTALL_AT,
        }
      );
      await expect(
        application.applyCurrentKnowledgeToPrinterState({
          printerId: "printer-a",
          printerStateId: "state-a",
        })
      ).resolves.toMatchObject({ status: "applied" });
      const persistedClaims = await claims.listByTarget(TARGET);
      expect(persistedClaims).toHaveLength(2);
      expect(persistedClaims.every((claim) => claim.trust === "customer_verified")).toBe(true);
      expect(
        persistedClaims.find((claim) => claim.fieldPath === "printer.nozzle.diameter")
      ).toMatchObject({
        value: { type: "number", value: 0.6 },
        provenance: {
          sourceRef: {
            packageId: "example.synthetic-installed-package",
            packageVersion: "1.0",
            factId: "model-nozzle",
          },
        },
      });
      await expect(
        new FieldResolutionService(claims).resolve({
          target: TARGET,
          fieldPath: "printer.nozzle.diameter",
        })
      ).resolves.toMatchObject({ status: "resolved", value: { type: "number", value: 0.6 } });
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
