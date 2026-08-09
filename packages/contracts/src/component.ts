export interface ComponentDefinitionReference {
  readonly packageId: string;
  readonly packageVersion: string;
  readonly definitionId: string;
}

export interface ComponentDefinition {
  readonly id: string;
  readonly kind: string;
  readonly displayName: string;
}

export interface ComponentInstallation {
  readonly id: string;
  readonly printerStateId: string;
  readonly componentInstanceId: string;
  readonly role: string;
  readonly kind: string;
  readonly displayName: string;
  readonly definitionRef?: ComponentDefinitionReference;
}
