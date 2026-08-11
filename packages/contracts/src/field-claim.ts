export type FieldClaimTarget =
  | { readonly type: "printer_state"; readonly printerStateId: string }
  | {
      readonly type: "component_installation";
      readonly componentInstallationId: string;
    };

export type FieldClaimValue =
  | { readonly type: "string"; readonly value: string }
  | { readonly type: "number"; readonly value: number }
  | { readonly type: "boolean"; readonly value: boolean };

export type CanonicalUnit = "mm" | "mm/s" | "mm/s2" | "degC" | "mm3/s" | "ratio";

export type ClaimSourceType =
  | "user_confirmed"
  | "user_entered"
  | "imported_file"
  | "slicer_profile"
  | "firmware_read"
  | "knowledge_package"
  | "component_definition"
  | "test_result"
  | "ai_unverified"
  | "state_transition";

export type ClaimSourceReference =
  | { readonly type: "import_snapshot"; readonly id: string }
  | { readonly type: "slicer_profile_snapshot"; readonly id: string }
  | { readonly type: "firmware_snapshot"; readonly id: string }
  | {
      readonly type: "knowledge_package";
      readonly packageId: string;
      readonly packageVersion: string;
      readonly factId?: string;
    }
  | {
      readonly type: "component_definition";
      readonly packageId: string;
      readonly packageVersion: string;
      readonly definitionId: string;
    }
  | { readonly type: "test_run"; readonly id: string }
  | {
      readonly type: "state_transition";
      readonly sourceClaimId: string;
      readonly transitionCommandId: string;
    };

export interface ClaimProvenance {
  readonly sourceType: ClaimSourceType;
  readonly sourceRef?: ClaimSourceReference;
}

export type ClaimTrust =
  | "developer_verified"
  | "customer_verified"
  | "user_confirmed"
  | "user_entered"
  | "imported_observation"
  | "ai_generated_unverified";

export interface FieldClaim {
  readonly id: string;
  readonly target: FieldClaimTarget;
  readonly fieldPath: string;
  readonly value: FieldClaimValue;
  readonly unit?: CanonicalUnit;
  readonly provenance: ClaimProvenance;
  readonly trust: ClaimTrust;
  readonly confidence?: number;
  readonly createdAt: string;
}
