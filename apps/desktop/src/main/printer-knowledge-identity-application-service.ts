import { randomUUID } from "node:crypto";

import type { PrinterKnowledgeIdentity } from "@printtune/contracts";
import { createPrinterKnowledgeIdentity } from "@printtune/core";
import type {
  PrinterKnowledgeIdentityLifecyclePersistence,
  PrinterKnowledgeIdentityRepository,
  PrinterKnowledgeIdentitySelectionPersistence,
  PrinterRepository,
} from "@printtune/storage";

import type { ActiveWorkspaceSession } from "./active-workspace-session";
import { NoActiveWorkspaceError, PrinterNotFoundError } from "./printer-flow-application-service";

export type SelectPrinterKnowledgeIdentityInput =
  | {
      readonly kind: "known";
      readonly packageId: string;
      readonly packageVersion: string;
      readonly seriesDefinitionId: string;
      readonly modelDefinitionId?: string;
      readonly manufacturerDisplayName: string;
      readonly seriesDisplayName: string;
      readonly modelDisplayName?: string;
    }
  | { readonly kind: "unclassified" };

interface PrinterKnowledgeIdentityApplicationServiceDependencies {
  readonly createIdentityId?: () => string;
  readonly now?: () => string;
}

export class CurrentPrinterKnowledgeIdentityNotFoundError extends Error {
  override readonly name = "CurrentPrinterKnowledgeIdentityNotFoundError";
  constructor(readonly identityId: string) {
    super(`Selected PrinterKnowledgeIdentity not found: ${identityId}`);
  }
}

export class PrinterKnowledgeIdentityApplicationService {
  readonly #lifecycle: PrinterKnowledgeIdentityLifecyclePersistence;
  readonly #identities: PrinterKnowledgeIdentityRepository;
  readonly #selection: PrinterKnowledgeIdentitySelectionPersistence;
  readonly #printers: PrinterRepository;
  readonly #activeWorkspace: ActiveWorkspaceSession;
  readonly #createIdentityId: () => string;
  readonly #now: () => string;

  constructor(
    lifecycle: PrinterKnowledgeIdentityLifecyclePersistence,
    identities: PrinterKnowledgeIdentityRepository,
    selection: PrinterKnowledgeIdentitySelectionPersistence,
    printers: PrinterRepository,
    activeWorkspace: ActiveWorkspaceSession,
    dependencies: PrinterKnowledgeIdentityApplicationServiceDependencies = {}
  ) {
    this.#lifecycle = lifecycle;
    this.#identities = identities;
    this.#selection = selection;
    this.#printers = printers;
    this.#activeWorkspace = activeWorkspace;
    this.#createIdentityId = dependencies.createIdentityId ?? randomUUID;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async createAndSelect(
    printerId: string,
    input: SelectPrinterKnowledgeIdentityInput
  ): Promise<PrinterKnowledgeIdentity> {
    await this.#authorizePrinter(printerId);
    const base = { id: this.#createIdentityId(), printerId, selectedAt: this.#now() };
    const identity =
      input.kind === "unclassified"
        ? createPrinterKnowledgeIdentity({ ...base, kind: "unclassified" })
        : createPrinterKnowledgeIdentity({
            ...base,
            kind: "known",
            definitionRef: {
              packageId: input.packageId,
              packageVersion: input.packageVersion,
              seriesDefinitionId: input.seriesDefinitionId,
              ...(input.modelDefinitionId === undefined
                ? {}
                : { modelDefinitionId: input.modelDefinitionId }),
            },
            manufacturerDisplayName: input.manufacturerDisplayName,
            seriesDisplayName: input.seriesDisplayName,
            ...(input.modelDisplayName === undefined
              ? {}
              : { modelDisplayName: input.modelDisplayName }),
          });

    await this.#lifecycle.createAndSelect(identity);
    return identity;
  }

  async getCurrentIdentity(printerId: string): Promise<PrinterKnowledgeIdentity | undefined> {
    await this.#authorizePrinter(printerId);
    const identityId = await this.#selection.getSelectedIdentityId(printerId);
    if (identityId === undefined) return undefined;
    const identity = await this.#identities.findById(identityId);
    if (!identity) throw new CurrentPrinterKnowledgeIdentityNotFoundError(identityId);
    return identity;
  }

  async listHistory(printerId: string): Promise<readonly PrinterKnowledgeIdentity[]> {
    await this.#authorizePrinter(printerId);
    return this.#identities.listByPrinterId(printerId);
  }

  async #authorizePrinter(printerId: string): Promise<void> {
    const workspace = await this.#activeWorkspace.getActiveWorkspace();
    if (!workspace) throw new NoActiveWorkspaceError();
    const printer = await this.#printers.findById(printerId);
    if (!printer || printer.workspaceId !== workspace.id) throw new PrinterNotFoundError(printerId);
  }
}
