import type {
  ClaimProvenance,
  ClaimSourceReference,
  FieldClaim,
  FieldClaimTarget,
  FieldClaimValue,
} from "@printtune/contracts";

import {
  DuplicateFieldClaimError,
  StateTransitionFieldClaimWriteError,
  type FieldClaimRepository,
} from "./field-claim-repository.js";

export const deleteFieldClaimForRollback = Symbol("deleteFieldClaimForRollback");

function copyTarget(target: FieldClaimTarget): FieldClaimTarget {
  return Object.freeze({ ...target });
}

function copyValue(value: FieldClaimValue): FieldClaimValue {
  return Object.freeze({ ...value });
}

function copyReference(reference: ClaimSourceReference): ClaimSourceReference {
  return Object.freeze({ ...reference });
}

function copyProvenance(provenance: ClaimProvenance): ClaimProvenance {
  return Object.freeze(
    provenance.sourceRef
      ? { ...provenance, sourceRef: copyReference(provenance.sourceRef) }
      : { ...provenance }
  );
}

function copyClaim(claim: FieldClaim): FieldClaim {
  return Object.freeze({
    ...claim,
    target: copyTarget(claim.target),
    value: copyValue(claim.value),
    provenance: copyProvenance(claim.provenance),
  });
}

function targetKey(target: FieldClaimTarget): string {
  return target.type === "printer_state"
    ? `printer_state:${target.printerStateId}`
    : `component_installation:${target.componentInstallationId}`;
}

function compareClaims(left: FieldClaim, right: FieldClaim): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export class InMemoryFieldClaimRepository implements FieldClaimRepository {
  readonly #claims = new Map<string, FieldClaim>();

  async create(claim: FieldClaim): Promise<void> {
    if (claim.provenance.sourceType === "state_transition") {
      throw new StateTransitionFieldClaimWriteError();
    }
    if (this.#claims.has(claim.id)) {
      throw new DuplicateFieldClaimError(claim.id);
    }
    this.#claims.set(claim.id, copyClaim(claim));
  }

  async createBatch(claims: readonly FieldClaim[]): Promise<void> {
    const staged = new Map<string, FieldClaim>();
    for (const claim of claims) {
      if (claim.provenance.sourceType === "state_transition") {
        throw new StateTransitionFieldClaimWriteError();
      }
      if (this.#claims.has(claim.id) || staged.has(claim.id)) {
        throw new DuplicateFieldClaimError(claim.id);
      }
      staged.set(claim.id, copyClaim(claim));
    }
    for (const [id, claim] of staged) this.#claims.set(id, claim);
  }

  [deleteFieldClaimForRollback](claimId: string): void {
    this.#claims.delete(claimId);
  }

  createForTransition(claim: FieldClaim): void {
    if (this.#claims.has(claim.id)) throw new DuplicateFieldClaimError(claim.id);
    this.#claims.set(claim.id, copyClaim(claim));
  }

  async findById(id: string): Promise<FieldClaim | undefined> {
    const claim = this.#claims.get(id);
    return claim ? copyClaim(claim) : undefined;
  }

  async listByTarget(target: FieldClaimTarget): Promise<FieldClaim[]> {
    const expectedTarget = targetKey(target);
    return [...this.#claims.values()]
      .filter((claim) => targetKey(claim.target) === expectedTarget)
      .sort(compareClaims)
      .map(copyClaim);
  }

  async listByTargetAndFieldPath(
    target: FieldClaimTarget,
    fieldPath: string
  ): Promise<FieldClaim[]> {
    return (await this.listByTarget(target)).filter((claim) => claim.fieldPath === fieldPath);
  }
}
