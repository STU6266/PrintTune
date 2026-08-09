import type { ComponentInstallation } from "@printtune/contracts";

export interface ComponentInstallationRepository {
  create(installation: ComponentInstallation): Promise<void>;
  findById(id: string): Promise<ComponentInstallation | undefined>;
  listByPrinterStateId(printerStateId: string): Promise<ComponentInstallation[]>;
  listByComponentInstanceId(componentInstanceId: string): Promise<ComponentInstallation[]>;
}

export class DuplicateComponentInstallationError extends Error {
  override readonly name = "DuplicateComponentInstallationError";

  constructor(readonly installationId: string) {
    super(`ComponentInstallation already exists: ${installationId}`);
  }
}

export class DuplicateComponentRoleError extends Error {
  override readonly name = "DuplicateComponentRoleError";

  constructor(
    readonly printerStateId: string,
    readonly role: string
  ) {
    super(`Component role already exists in PrinterState ${printerStateId}: ${role}`);
  }
}
