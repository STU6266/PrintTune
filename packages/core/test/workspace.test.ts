import { describe, expect, it } from "vitest";

import {
  InvalidWorkspaceNameError,
  InvalidWorkspaceTimestampError,
  createWorkspace,
  renameWorkspace,
} from "../src/index";

const WORKSPACE_ID = "workspace-001";
const CREATED_AT = "2026-08-08T10:00:00.000Z";
const UPDATED_AT = "2026-08-09T12:30:00.000Z";

describe("Workspace", () => {
  it("creates a deterministic Workspace from explicit inputs", () => {
    const workspace = createWorkspace({
      id: WORKSPACE_ID,
      name: "Mein Druckraum",
      timestamp: CREATED_AT,
    });

    expect(workspace).toEqual({
      id: WORKSPACE_ID,
      name: "Mein Druckraum",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
  });

  it("trims Workspace names", () => {
    const workspace = createWorkspace({
      id: WORKSPACE_ID,
      name: "  Werkstatt  ",
      timestamp: CREATED_AT,
    });

    expect(workspace.name).toBe("Werkstatt");
  });

  it("rejects timestamps that are not ISO-8601 UTC strings", () => {
    expect(() =>
      createWorkspace({
        id: WORKSPACE_ID,
        name: "Werkstatt",
        timestamp: "2026-08-08T10:00:00+02:00",
      })
    ).toThrow(InvalidWorkspaceTimestampError);
  });

  it.each(["2026-08-08T10:00:00Z", "2024-02-29T10:00:00.1Z"])(
    "accepts valid calendar timestamp %s",
    (timestamp) => {
      expect(createWorkspace({ id: WORKSPACE_ID, name: "Werkstatt", timestamp }).createdAt).toBe(
        timestamp
      );
    }
  );

  it.each(["2026-02-30T10:00:00Z", "2026-04-31T10:00:00Z", "2025-02-29T10:00:00Z"])(
    "rejects invalid calendar timestamp without normalization: %s",
    (timestamp) => {
      expect(() => createWorkspace({ id: WORKSPACE_ID, name: "Werkstatt", timestamp })).toThrow(
        InvalidWorkspaceTimestampError
      );
    }
  );

  it.each(["", " ", "\t\n"])("rejects an empty name: %j", (name) => {
    expect(() => createWorkspace({ id: WORKSPACE_ID, name, timestamp: CREATED_AT })).toThrow(
      InvalidWorkspaceNameError
    );
  });

  it("renames without mutating the existing Workspace", () => {
    const workspace = createWorkspace({
      id: WORKSPACE_ID,
      name: "Vorher",
      timestamp: CREATED_AT,
    });
    const originalSnapshot = { ...workspace };

    const renamedWorkspace = renameWorkspace(workspace, "  Nachher  ", UPDATED_AT);

    expect(renamedWorkspace).not.toBe(workspace);
    expect(workspace).toEqual(originalSnapshot);
    expect(renamedWorkspace).toEqual({
      id: WORKSPACE_ID,
      name: "Nachher",
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });
  });

  it("rejects an empty name when renaming", () => {
    const workspace = createWorkspace({
      id: WORKSPACE_ID,
      name: "Vorher",
      timestamp: CREATED_AT,
    });

    expect(() => renameWorkspace(workspace, "   ", UPDATED_AT)).toThrow(InvalidWorkspaceNameError);
  });
});
