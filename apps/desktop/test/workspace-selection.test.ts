import { createWorkspace } from "@printtune/core";
import { describe, expect, it } from "vitest";

import { isWorkspaceActive } from "../src/renderer/workspace-selection";

const first = createWorkspace({
  id: "workspace-a",
  name: "Werkstatt A",
  timestamp: "2026-08-08T12:00:00.000Z",
});
const second = createWorkspace({
  id: "workspace-b",
  name: "Werkstatt B",
  timestamp: "2026-08-08T12:00:00.000Z",
});

describe("Workspace renderer selection", () => {
  it("has no visibly active Workspace without a selection", () => {
    expect(isWorkspaceActive(undefined, first)).toBe(false);
    expect(isWorkspaceActive(undefined, second)).toBe(false);
  });

  it("marks only the selected Workspace active", () => {
    expect(isWorkspaceActive(first, first)).toBe(true);
    expect(isWorkspaceActive(first, second)).toBe(false);
  });

  it("reflects switching to a different Workspace", () => {
    expect(isWorkspaceActive(second, first)).toBe(false);
    expect(isWorkspaceActive(second, second)).toBe(true);
  });

  it("keeps a renamed Workspace active by ID and clears deleted active state", () => {
    const renamed = { ...first, name: "Werkstatt Alpha" };

    expect(isWorkspaceActive(renamed, renamed)).toBe(true);
    expect(isWorkspaceActive(undefined, renamed)).toBe(false);
  });
});
