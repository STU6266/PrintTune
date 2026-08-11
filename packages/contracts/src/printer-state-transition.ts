import type { ComponentDefinitionReference, ComponentInstallation } from "./component.js";
import type { FieldClaim } from "./field-claim.js";
import type { PrinterState } from "./printer-state.js";

export type ComponentTransitionDecision =
  | { readonly type: "retain"; readonly sourceComponentInstallationId: string }
  | { readonly type: "remove"; readonly sourceComponentInstallationId: string };

export interface AddedComponentInstallationInput {
  readonly role: string;
  readonly kind: string;
  readonly displayName: string;
  readonly definitionRef?: ComponentDefinitionReference;
}

export interface FieldClaimCarryDecision {
  readonly sourceClaim: FieldClaim;
  readonly applicabilityConfirmed: boolean;
}

export interface PrinterStateTransitionPlan {
  readonly transitionCommandId: string;
  readonly printerId: string;
  readonly sourcePrinterStateId: string;
  readonly targetPrinterState: PrinterState;
  readonly componentDecisions: readonly ComponentTransitionDecision[];
  readonly targetComponentInstallations: readonly ComponentInstallation[];
  readonly carriedClaims: readonly FieldClaim[];
}
