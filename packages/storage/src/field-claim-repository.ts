import type { FieldClaim, FieldClaimTarget } from "@printtune/contracts";

export interface FieldClaimRepository {
  create(claim: FieldClaim): Promise<void>;
  createBatch(claims: readonly FieldClaim[]): Promise<void>;
  findById(id: string): Promise<FieldClaim | undefined>;
  listByTarget(target: FieldClaimTarget): Promise<FieldClaim[]>;
  listByTargetAndFieldPath(target: FieldClaimTarget, fieldPath: string): Promise<FieldClaim[]>;
}

export class DuplicateFieldClaimError extends Error {
  override readonly name = "DuplicateFieldClaimError";

  constructor(readonly claimId: string) {
    super(`FieldClaim already exists: ${claimId}`);
  }
}
