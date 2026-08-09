import type {
  ComponentDefinitionReference,
  ComponentInstallation,
  PrinterState,
} from "@printtune/contracts";

import {
  DuplicateComponentInstallationError,
  DuplicateComponentRoleError,
  type ComponentInstallationRepository,
} from "./component-installation-repository.js";

export interface ComponentInstallationPrinterStateLookup {
  findById(id: string): Promise<Pick<PrinterState, "id" | "createdAt"> | undefined>;
}

export class MissingComponentInstallationPrinterStateError extends Error {
  override readonly name = "MissingComponentInstallationPrinterStateError";

  constructor(readonly printerStateId: string) {
    super(
      `PrinterState metadata is unavailable for ComponentInstallation history: ${printerStateId}`
    );
  }
}

function copyReference(reference: ComponentDefinitionReference): ComponentDefinitionReference {
  return Object.freeze({ ...reference });
}

function copyInstallation(installation: ComponentInstallation): ComponentInstallation {
  return Object.freeze(
    installation.definitionRef
      ? { ...installation, definitionRef: copyReference(installation.definitionRef) }
      : { ...installation }
  );
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

export class InMemoryComponentInstallationRepository implements ComponentInstallationRepository {
  readonly #installations = new Map<string, ComponentInstallation>();
  readonly #printerStates: ComponentInstallationPrinterStateLookup;

  constructor(printerStates: ComponentInstallationPrinterStateLookup) {
    this.#printerStates = printerStates;
  }

  async create(installation: ComponentInstallation): Promise<void> {
    if (this.#installations.has(installation.id)) {
      throw new DuplicateComponentInstallationError(installation.id);
    }
    if (
      [...this.#installations.values()].some(
        (existing) =>
          existing.printerStateId === installation.printerStateId &&
          existing.role === installation.role
      )
    ) {
      throw new DuplicateComponentRoleError(installation.printerStateId, installation.role);
    }

    this.#installations.set(installation.id, copyInstallation(installation));
  }

  async findById(id: string): Promise<ComponentInstallation | undefined> {
    const installation = this.#installations.get(id);
    return installation ? copyInstallation(installation) : undefined;
  }

  async listByPrinterStateId(printerStateId: string): Promise<ComponentInstallation[]> {
    return [...this.#installations.values()]
      .filter((installation) => installation.printerStateId === printerStateId)
      .sort(
        (left, right) => compareStrings(left.role, right.role) || compareStrings(left.id, right.id)
      )
      .map(copyInstallation);
  }

  async listByComponentInstanceId(componentInstanceId: string): Promise<ComponentInstallation[]> {
    const installations = [...this.#installations.values()].filter(
      (installation) => installation.componentInstanceId === componentInstanceId
    );
    const states = new Map<string, Pick<PrinterState, "id" | "createdAt">>();
    await Promise.all(
      [...new Set(installations.map((installation) => installation.printerStateId))].map(
        async (printerStateId) => {
          const state = await this.#printerStates.findById(printerStateId);
          if (!state) {
            throw new MissingComponentInstallationPrinterStateError(printerStateId);
          }
          states.set(printerStateId, state);
        }
      )
    );

    return installations
      .sort((left, right) => {
        const leftState = states.get(left.printerStateId);
        const rightState = states.get(right.printerStateId);
        if (!leftState || !rightState) {
          throw new MissingComponentInstallationPrinterStateError(
            !leftState ? left.printerStateId : right.printerStateId
          );
        }
        return (
          compareStrings(leftState.createdAt, rightState.createdAt) ||
          compareStrings(leftState.id, rightState.id) ||
          compareStrings(left.id, right.id)
        );
      })
      .map(copyInstallation);
  }
}
