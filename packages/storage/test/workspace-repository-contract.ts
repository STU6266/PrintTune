import type { Workspace } from "@printtune/contracts";
import { createWorkspace } from "@printtune/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WorkspaceRepository } from "../src/workspace-repository";

const FIRST_TIMESTAMP = "2026-08-08T10:00:00.000Z";
const SECOND_TIMESTAMP = "2026-08-09T10:00:00.000Z";

export interface WorkspaceRepositoryFixture {
  readonly repository: WorkspaceRepository;
  readonly close: () => void | Promise<void>;
}

function workspace(id: string, createdAt = FIRST_TIMESTAMP, name = `Workspace ${id}`): Workspace {
  return createWorkspace({ id, name, timestamp: createdAt });
}

export function describeWorkspaceRepository(
  name: string,
  createFixture: () => WorkspaceRepositoryFixture | Promise<WorkspaceRepositoryFixture>
): void {
  describe(name, () => {
    let fixture: WorkspaceRepositoryFixture;

    beforeEach(async () => {
      fixture = await createFixture();
    });

    afterEach(async () => {
      await fixture.close();
    });

    it("starts empty", async () => {
      await expect(fixture.repository.list()).resolves.toEqual([]);
    });

    it("saves and finds a Workspace by ID", async () => {
      const savedWorkspace = workspace("workspace-001");

      await fixture.repository.save(savedWorkspace);

      await expect(fixture.repository.findById(savedWorkspace.id)).resolves.toEqual(savedWorkspace);
    });

    it("returns undefined for a missing Workspace", async () => {
      await expect(fixture.repository.findById("missing")).resolves.toBeUndefined();
    });

    it("replaces the complete Workspace stored under the same ID", async () => {
      const original = workspace("workspace-001");
      const replacement = workspace("workspace-001", SECOND_TIMESTAMP, "Umbenannt");

      await fixture.repository.save(original);
      await fixture.repository.save(replacement);

      await expect(fixture.repository.list()).resolves.toEqual([replacement]);
    });

    it("lists multiple Workspaces by createdAt and then ID", async () => {
      const later = workspace("workspace-003", SECOND_TIMESTAMP);
      const tiedSecond = workspace("workspace-002");
      const tiedFirst = workspace("workspace-001");

      await fixture.repository.save(later);
      await fixture.repository.save(tiedSecond);
      await fixture.repository.save(tiedFirst);

      await expect(fixture.repository.list()).resolves.toEqual([tiedFirst, tiedSecond, later]);
    });

    it("deletes an existing Workspace", async () => {
      const savedWorkspace = workspace("workspace-001");
      await fixture.repository.save(savedWorkspace);

      await expect(fixture.repository.delete(savedWorkspace.id)).resolves.toBe(true);
      await expect(fixture.repository.findById(savedWorkspace.id)).resolves.toBeUndefined();
    });

    it("returns false when deleting a missing Workspace", async () => {
      await expect(fixture.repository.delete("missing")).resolves.toBe(false);
    });

    it("preserves Unicode and punctuation in names", async () => {
      const values = [
        workspace("unicode", FIRST_TIMESTAMP, "Prüfung 日本語 🖨️"),
        workspace("quotes", SECOND_TIMESTAMP, `O'Reillys "Drucker"`),
      ];

      for (const value of values) {
        await fixture.repository.save(value);
      }

      await expect(fixture.repository.list()).resolves.toEqual(values);
    });

    it("stores SQL-like text as ordinary data", async () => {
      const sqlLikeWorkspace = workspace(
        "sql-text",
        FIRST_TIMESTAMP,
        "'); DROP TABLE workspaces; --"
      );

      await fixture.repository.save(sqlLikeWorkspace);

      await expect(fixture.repository.findById(sqlLikeWorkspace.id)).resolves.toEqual(
        sqlLikeWorkspace
      );
    });

    it("does not retain a mutable reference passed to save", async () => {
      const savedWorkspace = workspace("workspace-001");
      await fixture.repository.save(savedWorkspace);

      (savedWorkspace as { name: string }).name = "Extern verändert";

      await expect(fixture.repository.findById(savedWorkspace.id)).resolves.toMatchObject({
        name: "Workspace workspace-001",
      });
    });

    it("does not expose mutable repository state through returned values", async () => {
      const savedWorkspace = workspace("workspace-001");
      await fixture.repository.save(savedWorkspace);

      const found = await fixture.repository.findById(savedWorkspace.id);
      const listed = await fixture.repository.list();

      (found as { name: string }).name = "Fund verändert";
      (listed[0] as { name: string }).name = "Liste verändert";
      listed.length = 0;

      await expect(fixture.repository.findById(savedWorkspace.id)).resolves.toEqual(savedWorkspace);
      await expect(fixture.repository.list()).resolves.toEqual([savedWorkspace]);
    });
  });
}
