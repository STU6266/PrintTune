import type { ComponentInstallation } from "@printtune/contracts";
import { createComponentInstallation } from "@printtune/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DuplicateComponentInstallationError,
  DuplicateComponentRoleError,
  type ComponentInstallationRepository,
} from "../src/component-installation-repository";

export interface ComponentInstallationRepositoryFixture {
  readonly repository: ComponentInstallationRepository;
  readonly close: () => void | Promise<void>;
}

function installation(
  id: string,
  printerStateId = "state-early",
  role = "toolhead.hotend",
  componentInstanceId = `instance-${id}`,
  definitionRef?: { packageId: string; packageVersion: string; definitionId: string }
): ComponentInstallation {
  return createComponentInstallation({
    id,
    printerStateId,
    componentInstanceId,
    role,
    kind: role.includes("motor") ? "stepper-motor" : "hotend",
    displayName: `Component ${id}`,
    ...(definitionRef ? { definitionRef } : {}),
  });
}

export function describeComponentInstallationRepository(
  name: string,
  createFixture: () =>
    ComponentInstallationRepositoryFixture | Promise<ComponentInstallationRepositoryFixture>
): void {
  describe(name, () => {
    let fixture: ComponentInstallationRepositoryFixture;
    beforeEach(async () => {
      fixture = await createFixture();
    });
    afterEach(async () => fixture.close());

    it("starts with empty lookups and lists", async () => {
      await expect(fixture.repository.findById("missing")).resolves.toBeUndefined();
      await expect(fixture.repository.listByPrinterStateId("state-early")).resolves.toEqual([]);
      await expect(fixture.repository.listByComponentInstanceId("missing")).resolves.toEqual([]);
    });

    it("creates and finds unknown and known component snapshots", async () => {
      const unknown = installation("installation-unknown");
      const known = installation(
        "installation-known",
        "state-early",
        "toolhead.extruder",
        "instance-known",
        {
          packageId: "components.base",
          packageVersion: "1.0.0",
          definitionId: "extruder.known",
        }
      );
      await fixture.repository.create(unknown);
      await fixture.repository.create(known);

      await expect(fixture.repository.findById(unknown.id)).resolves.toEqual(unknown);
      await expect(fixture.repository.findById(known.id)).resolves.toEqual(known);
    });

    it("filters one PrinterState and orders by role then ID", async () => {
      const secondId = installation("installation-b", "state-early", "motion.z.motor.left");
      const laterRole = installation("installation-c", "state-early", "motion.z.motor.right");
      const firstId = installation("installation-a", "state-early", "motion.z.motor.left.aux");
      const other = installation("installation-other", "state-other");
      for (const value of [laterRole, secondId, other, firstId]) {
        await fixture.repository.create(value);
      }

      await expect(fixture.repository.listByPrinterStateId("state-early")).resolves.toEqual([
        secondId,
        firstId,
        laterRole,
      ]);
    });

    it("orders one physical component's snapshots by state time, state ID, then installation ID", async () => {
      const tieLaterState = installation(
        "installation-tie-b",
        "state-tie-b",
        "toolhead.hotend",
        "instance-shared"
      );
      const tieEarlierState = installation(
        "installation-tie-a",
        "state-tie-a",
        "toolhead.hotend",
        "instance-shared"
      );
      const earlySecond = installation(
        "installation-b",
        "state-early",
        "toolhead.hotend.aux",
        "instance-shared"
      );
      const earlyFirst = installation(
        "installation-a",
        "state-early",
        "toolhead.hotend",
        "instance-shared"
      );
      await fixture.repository.create(tieLaterState);
      await fixture.repository.create(tieEarlierState);
      await fixture.repository.create(earlySecond);
      await fixture.repository.create(
        installation("other-instance", "state-early", "toolhead.extruder", "instance-other")
      );
      await fixture.repository.create(earlyFirst);

      await expect(
        fixture.repository.listByComponentInstanceId("instance-shared")
      ).resolves.toEqual([earlyFirst, earlySecond, tieEarlierState, tieLaterState]);
    });

    it("rejects duplicate IDs without replacing the original", async () => {
      const original = installation("installation-a");
      await fixture.repository.create(original);

      await expect(
        fixture.repository.create(
          installation("installation-a", "state-tie-a", "toolhead.extruder")
        )
      ).rejects.toBeInstanceOf(DuplicateComponentInstallationError);
      await expect(fixture.repository.findById(original.id)).resolves.toEqual(original);
    });

    it("enforces role uniqueness within a state but permits the same role in another state", async () => {
      const original = installation("installation-a");
      await fixture.repository.create(original);
      await expect(
        fixture.repository.create(
          installation("installation-b", "state-early", "toolhead.hotend", "instance-b")
        )
      ).rejects.toBeInstanceOf(DuplicateComponentRoleError);
      await expect(fixture.repository.findById(original.id)).resolves.toEqual(original);
      await expect(
        fixture.repository.create(
          installation("installation-c", "state-tie-a", "toolhead.hotend", "instance-a")
        )
      ).resolves.toBeUndefined();
    });

    it("allows the same kind multiple times under different roles", async () => {
      const left = installation("left", "state-early", "motion.z.motor.left");
      const right = installation("right", "state-early", "motion.z.motor.right");
      await fixture.repository.create(left);
      await fixture.repository.create(right);

      await expect(fixture.repository.listByPrinterStateId("state-early")).resolves.toEqual([
        left,
        right,
      ]);
    });

    it("stores and returns defensive frozen copies", async () => {
      const mutable = {
        ...installation("installation-a", "state-early", "toolhead.hotend", "instance-a", {
          packageId: "components.base",
          packageVersion: "1.0.0",
          definitionId: "hotend.known",
        }),
        definitionRef: {
          packageId: "components.base",
          packageVersion: "1.0.0",
          definitionId: "hotend.known",
        },
      };
      await fixture.repository.create(mutable);
      mutable.displayName = "Changed input";
      mutable.definitionRef.definitionId = "changed";
      const found = await fixture.repository.findById(mutable.id);

      expect(found).toMatchObject({
        displayName: "Component installation-a",
        definitionRef: { definitionId: "hotend.known" },
      });
      expect(Object.isFrozen(found)).toBe(true);
      expect(Object.isFrozen(found?.definitionRef)).toBe(true);
      expect(() => {
        (found as { displayName: string }).displayName = "Changed result";
      }).toThrow();
    });
  });
}
