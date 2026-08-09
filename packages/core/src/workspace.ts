import type { Workspace } from "@printtune/contracts";

import { isStrictIsoUtcTimestamp } from "./timestamp-validation.js";

export interface CreateWorkspaceInput {
  readonly id: string;
  readonly name: string;
  readonly timestamp: string;
}

export class InvalidWorkspaceNameError extends Error {
  override readonly name = "InvalidWorkspaceNameError";

  constructor() {
    super("Workspace name must not be empty");
  }
}

export class InvalidWorkspaceTimestampError extends Error {
  override readonly name = "InvalidWorkspaceTimestampError";

  constructor() {
    super("Workspace timestamp must be an ISO-8601 UTC string");
  }
}

function validateWorkspaceTimestamp(timestamp: string): string {
  if (!isStrictIsoUtcTimestamp(timestamp)) {
    throw new InvalidWorkspaceTimestampError();
  }

  return timestamp;
}

function normalizeWorkspaceName(name: string): string {
  const normalizedName = name.trim();

  if (normalizedName.length === 0) {
    throw new InvalidWorkspaceNameError();
  }

  return normalizedName;
}

export function createWorkspace(input: CreateWorkspaceInput): Workspace {
  const name = normalizeWorkspaceName(input.name);
  const timestamp = validateWorkspaceTimestamp(input.timestamp);

  return {
    id: input.id,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function renameWorkspace(workspace: Workspace, name: string, timestamp: string): Workspace {
  return {
    ...workspace,
    name: normalizeWorkspaceName(name),
    updatedAt: validateWorkspaceTimestamp(timestamp),
  };
}
