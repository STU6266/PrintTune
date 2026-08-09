import type {
  FieldClaim,
  FieldClaimTarget,
  FieldDefinition,
  ResolvedField,
} from "@printtune/contracts";
import { createResolvedField, findCoreFieldDefinition, resolveFieldClaims } from "@printtune/core";
import type { FieldClaimRepository } from "@printtune/storage";

export interface ResolveFieldInput {
  readonly target: FieldClaimTarget;
  readonly fieldPath: string;
}

export interface FieldDefinitionLookup {
  readonly find: (fieldPath: string) => FieldDefinition | undefined;
}

export class FieldDefinitionTargetMismatchError extends Error {
  override readonly name = "FieldDefinitionTargetMismatchError";
  constructor(
    readonly fieldPath: string,
    readonly expectedTargetType: FieldDefinition["targetType"],
    readonly actualTargetType: FieldClaimTarget["type"]
  ) {
    super(
      `FieldDefinition target mismatch for ${fieldPath}: expected ${expectedTargetType}, received ${actualTargetType}`
    );
  }
}

const CORE_FIELD_DEFINITION_LOOKUP: FieldDefinitionLookup = Object.freeze({
  find: findCoreFieldDefinition,
});

function targetsMatch(left: FieldClaimTarget, right: FieldClaimTarget): boolean {
  if (left.type !== right.type) return false;
  return left.type === "printer_state"
    ? left.printerStateId === (right as { readonly printerStateId: string }).printerStateId
    : left.componentInstallationId ===
        (right as { readonly componentInstallationId: string }).componentInstallationId;
}

function representationMatches(
  claim: FieldClaim,
  target: FieldClaimTarget,
  definition: FieldDefinition
): boolean {
  return (
    targetsMatch(claim.target, target) &&
    claim.fieldPath === definition.fieldPath &&
    claim.value.type === definition.valueType &&
    claim.unit === definition.unit
  );
}

function compareClaims(left: FieldClaim, right: FieldClaim): number {
  return (
    Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id)
  );
}

export class FieldResolutionService {
  readonly #repository: FieldClaimRepository;
  readonly #definitions: FieldDefinitionLookup;

  constructor(
    repository: FieldClaimRepository,
    definitions: FieldDefinitionLookup = CORE_FIELD_DEFINITION_LOOKUP
  ) {
    this.#repository = repository;
    this.#definitions = definitions;
  }

  async resolve(input: ResolveFieldInput): Promise<ResolvedField> {
    const definition = this.#definitions.find(input.fieldPath);
    if (!definition) {
      return createResolvedField({
        target: input.target,
        fieldPath: input.fieldPath,
        status: "blocked",
        supportingClaimIds: [],
        reasonCode: "unknown_field_definition",
      });
    }
    if (definition.targetType !== input.target.type) {
      throw new FieldDefinitionTargetMismatchError(
        input.fieldPath,
        definition.targetType,
        input.target.type
      );
    }

    const claims = await this.#repository.listByTargetAndFieldPath(input.target, input.fieldPath);
    if (claims.some((claim) => !representationMatches(claim, input.target, definition))) {
      const supportingClaimIds = [...claims].sort(compareClaims).map((claim) => claim.id);
      return createResolvedField({
        target: input.target,
        fieldPath: input.fieldPath,
        status: "blocked",
        supportingClaimIds,
        reasonCode: "incompatible_claim_representations",
      });
    }

    return resolveFieldClaims({
      target: input.target,
      fieldPath: input.fieldPath,
      claims,
      policy: definition.resolutionPolicy,
    });
  }
}
