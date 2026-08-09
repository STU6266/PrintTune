import { createComponentInstallation, createPrinterState } from "@printtune/core";
import { describe, expect, it, vi } from "vitest";

import {
  InMemoryComponentInstallationRepository,
  InMemoryPrinterStateRepository,
  MissingComponentInstallationPrinterStateError,
} from "../src/index";
import { describeComponentInstallationRepository } from "./component-installation-repository-contract";

describeComponentInstallationRepository("InMemoryComponentInstallationRepository", async () => {
  const states = new InMemoryPrinterStateRepository();
  await states.create(
    createPrinterState({
      id: "state-early",
      printerId: "printer-a",
      timestamp: "2026-08-08T10:00:00.000Z",
    })
  );
  await states.create(
    createPrinterState({
      id: "state-tie-a",
      printerId: "printer-a",
      timestamp: "2026-08-09T10:00:00.000Z",
    })
  );
  await states.create(
    createPrinterState({
      id: "state-tie-b",
      printerId: "printer-a",
      timestamp: "2026-08-09T10:00:00.000Z",
    })
  );

  return {
    repository: new InMemoryComponentInstallationRepository(states),
    close() {},
  };
});

describe("InMemoryComponentInstallationRepository history metadata", () => {
  it("does not validate PrinterState existence during create", async () => {
    const findById = vi.fn().mockResolvedValue(undefined);
    const repository = new InMemoryComponentInstallationRepository({ findById });

    await expect(
      repository.create(
        createComponentInstallation({
          id: "installation-missing-state",
          printerStateId: "state-missing",
          componentInstanceId: "instance-a",
          role: "toolhead.hotend",
          kind: "hotend",
          displayName: "Hotend",
        })
      )
    ).resolves.toBeUndefined();
    expect(findById).not.toHaveBeenCalled();
  });

  it("fails explicitly when historical state metadata cannot be resolved", async () => {
    const repository = new InMemoryComponentInstallationRepository({
      findById: vi.fn().mockResolvedValue(undefined),
    });
    await repository.create(
      createComponentInstallation({
        id: "installation-missing-state",
        printerStateId: "state-missing",
        componentInstanceId: "instance-a",
        role: "toolhead.hotend",
        kind: "hotend",
        displayName: "Hotend",
      })
    );

    await expect(repository.listByComponentInstanceId("instance-a")).rejects.toMatchObject({
      name: "MissingComponentInstallationPrinterStateError",
      printerStateId: "state-missing",
    } satisfies Partial<MissingComponentInstallationPrinterStateError>);
  });
});
