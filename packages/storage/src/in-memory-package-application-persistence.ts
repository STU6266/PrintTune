import type {
  FieldClaim,
  FieldClaimTarget,
  PackageApplication,
  PackageApplicationKey,
} from "@printtune/contracts";
import { getPackageApplicationKey } from "@printtune/core";

import { DuplicateFieldClaimError, type FieldClaimRepository } from "./field-claim-repository.js";
import {
  PackageApplicationMetadataConflictError,
  type PackageApplicationApplyOnceResult,
  type PackageApplicationLifecyclePersistence,
  validatePackageApplicationBatch,
} from "./package-application-lifecycle-persistence.js";
import type {
  PackageApplicationClaimRepository,
  PackageApplicationRepository,
} from "./package-application-repository.js";

const copyApplication = (value: PackageApplication): PackageApplication =>
  Object.freeze({ ...value });
const copyClaim = (value: FieldClaim): FieldClaim =>
  Object.freeze({
    ...value,
    target: Object.freeze({ ...value.target }),
    value: Object.freeze({ ...value.value }),
    provenance: Object.freeze({
      ...value.provenance,
      ...(value.provenance.sourceRef
        ? { sourceRef: Object.freeze({ ...value.provenance.sourceRef }) }
        : {}),
    }),
  });

function sameKey(left: PackageApplicationKey, right: PackageApplicationKey): boolean {
  return (
    left.printerStateId === right.printerStateId &&
    left.packageId === right.packageId &&
    left.packageVersion === right.packageVersion &&
    left.seriesDefinitionId === right.seriesDefinitionId &&
    left.modelDefinitionId === right.modelDefinitionId &&
    left.coreContractVersion === right.coreContractVersion
  );
}

function targetKey(target: FieldClaimTarget): string {
  return target.type === "printer_state"
    ? `printer_state:${target.printerStateId}`
    : `component_installation:${target.componentInstallationId}`;
}

export class InMemoryPackageApplicationPersistence
  implements
    PackageApplicationLifecyclePersistence,
    PackageApplicationRepository,
    PackageApplicationClaimRepository
{
  readonly #applications = new Map<string, PackageApplication>();
  readonly #claims = new Map<string, FieldClaim>();
  readonly #claimIds = new Map<string, readonly string[]>();

  async applyOnce(
    application: PackageApplication,
    claims: readonly FieldClaim[]
  ): Promise<PackageApplicationApplyOnceResult> {
    validatePackageApplicationBatch(application, claims);
    const existing = await this.findBySemanticKey(getPackageApplicationKey(application));
    if (existing) {
      if (existing.packageTrust !== application.packageTrust) {
        throw new PackageApplicationMetadataConflictError(existing.id);
      }
      return { status: "already_applied", application: existing };
    }
    for (const claim of claims) {
      if (this.#claims.has(claim.id)) throw new DuplicateFieldClaimError(claim.id);
    }
    if (this.#applications.has(application.id)) {
      throw new Error(`PackageApplication ID ${application.id} already exists`);
    }
    const storedApplication = copyApplication(application);
    const stagedClaims = claims.map(copyClaim);
    this.#applications.set(application.id, storedApplication);
    for (const claim of stagedClaims) this.#claims.set(claim.id, claim);
    this.#claimIds.set(application.id, Object.freeze(stagedClaims.map(({ id }) => id)));
    return { status: "applied", application: copyApplication(storedApplication) };
  }

  async findById(id: string): Promise<PackageApplication | undefined> {
    const value = this.#applications.get(id);
    return value ? copyApplication(value) : undefined;
  }

  async findBySemanticKey(key: PackageApplicationKey): Promise<PackageApplication | undefined> {
    const value = [...this.#applications.values()].find((candidate) =>
      sameKey(getPackageApplicationKey(candidate), key)
    );
    return value ? copyApplication(value) : undefined;
  }

  async listForPrinterState(printerStateId: string): Promise<readonly PackageApplication[]> {
    return [...this.#applications.values()]
      .filter((value) => value.printerStateId === printerStateId)
      .sort((a, b) => a.appliedAt.localeCompare(b.appliedAt) || a.id.localeCompare(b.id))
      .map(copyApplication);
  }

  async listClaimIds(applicationId: string): Promise<readonly string[]> {
    return [...(this.#claimIds.get(applicationId) ?? [])];
  }

  async create(claim: FieldClaim): Promise<void> {
    if (this.#claims.has(claim.id)) throw new DuplicateFieldClaimError(claim.id);
    this.#claims.set(claim.id, copyClaim(claim));
  }

  async createBatch(claims: readonly FieldClaim[]): Promise<void> {
    const staged = new Map<string, FieldClaim>();
    for (const claim of claims) {
      if (this.#claims.has(claim.id) || staged.has(claim.id)) {
        throw new DuplicateFieldClaimError(claim.id);
      }
      staged.set(claim.id, copyClaim(claim));
    }
    for (const [id, claim] of staged) this.#claims.set(id, claim);
  }

  async findClaimById(id: string): Promise<FieldClaim | undefined> {
    const value = this.#claims.get(id);
    return value ? copyClaim(value) : undefined;
  }

  // TypeScript cannot express two interface methods with the same name and different entities.
  // FieldClaim reads are available through this explicit adapter.
  asFieldClaimRepository(): FieldClaimRepository {
    return {
      create: (claim) => this.create(claim),
      createBatch: (claims) => this.createBatch(claims),
      findById: (id) => this.findClaimById(id),
      listByTarget: (target) => this.listByTarget(target),
      listByTargetAndFieldPath: (target, path) => this.listByTargetAndFieldPath(target, path),
    };
  }

  async listByTarget(target: FieldClaimTarget): Promise<FieldClaim[]> {
    const key = targetKey(target);
    return [...this.#claims.values()]
      .filter((claim) => targetKey(claim.target) === key)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(copyClaim);
  }

  async listByTargetAndFieldPath(target: FieldClaimTarget, path: string): Promise<FieldClaim[]> {
    return (await this.listByTarget(target)).filter((claim) => claim.fieldPath === path);
  }
}
