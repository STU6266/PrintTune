import type { Workspace } from "@printtune/contracts";

export const WORKSPACE_LIST_CHANNEL = "workspace:list" as const;
export const WORKSPACE_CREATE_CHANNEL = "workspace:create" as const;
export const WORKSPACE_GET_ACTIVE_CHANNEL = "workspace:active:get" as const;
export const WORKSPACE_SET_ACTIVE_CHANNEL = "workspace:active:set" as const;
export const WORKSPACE_RENAME_CHANNEL = "workspace:rename" as const;
export const WORKSPACE_DELETE_CHANNEL = "workspace:delete" as const;

export interface CreateWorkspaceRequest {
  readonly name: string;
}

export interface SetActiveWorkspaceRequest {
  readonly id: string;
}

export interface RenameWorkspaceRequest {
  readonly id: string;
  readonly name: string;
}

export interface DeleteWorkspaceRequest {
  readonly id: string;
}

export interface WorkspaceApi {
  listWorkspaces(): Promise<readonly Workspace[]>;
  createWorkspace(input: CreateWorkspaceRequest): Promise<Workspace>;
  getActiveWorkspace(): Promise<Workspace | undefined>;
  setActiveWorkspace(id: string): Promise<Workspace>;
  renameWorkspace(id: string, name: string): Promise<Workspace>;
  deleteWorkspace(id: string): Promise<boolean>;
}

type WorkspaceChannel =
  | typeof WORKSPACE_LIST_CHANNEL
  | typeof WORKSPACE_CREATE_CHANNEL
  | typeof WORKSPACE_GET_ACTIVE_CHANNEL
  | typeof WORKSPACE_SET_ACTIVE_CHANNEL
  | typeof WORKSPACE_RENAME_CHANNEL
  | typeof WORKSPACE_DELETE_CHANNEL;
type WorkspaceInvoke = (channel: WorkspaceChannel, payload?: unknown) => Promise<unknown>;

const ISO_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_UTC_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }

  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) {
    return false;
  }

  const normalizedValue = value.includes(".")
    ? value.replace(/\.(\d{1,3})Z$/, (_, fraction: string) => `.${fraction.padEnd(3, "0")}Z`)
    : value.replace("Z", ".000Z");

  return new Date(milliseconds).toISOString() === normalizedValue;
}

function isWorkspace(value: unknown): value is Workspace {
  if (!isRecord(value) || Object.keys(value).length !== 4) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.trim() === value.id &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    isIsoUtcTimestamp(value.createdAt) &&
    isIsoUtcTimestamp(value.updatedAt)
  );
}

export function assertCreateWorkspaceRequest(value: unknown): CreateWorkspaceRequest {
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.name !== "string") {
    throw new TypeError("Invalid Workspace create request");
  }

  return Object.freeze({ name: value.name });
}

export function assertSetActiveWorkspaceRequest(value: unknown): SetActiveWorkspaceRequest {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.trim() !== value.id
  ) {
    throw new TypeError("Invalid active Workspace request");
  }

  return Object.freeze({ id: value.id });
}

function hasValidWorkspaceId(
  value: Record<string, unknown>
): value is Record<string, unknown> & { id: string } {
  return typeof value.id === "string" && value.id.length > 0 && value.id.trim() === value.id;
}

export function assertRenameWorkspaceRequest(value: unknown): RenameWorkspaceRequest {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !hasValidWorkspaceId(value) ||
    typeof value.name !== "string"
  ) {
    throw new TypeError("Invalid Workspace rename request");
  }

  return Object.freeze({ id: value.id, name: value.name });
}

export function assertDeleteWorkspaceRequest(value: unknown): DeleteWorkspaceRequest {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !hasValidWorkspaceId(value)) {
    throw new TypeError("Invalid Workspace delete request");
  }

  return Object.freeze({ id: value.id });
}

export function assertWorkspace(value: unknown): Workspace {
  if (!isWorkspace(value)) {
    throw new TypeError("Invalid Workspace response");
  }

  return Object.freeze({ ...value });
}

export function assertWorkspaceList(value: unknown): readonly Workspace[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Invalid Workspace list response");
  }

  return Object.freeze(value.map(assertWorkspace));
}

export function assertOptionalWorkspace(value: unknown): Workspace | undefined {
  return value === undefined ? undefined : assertWorkspace(value);
}

export function createWorkspaceApi(invoke: WorkspaceInvoke): WorkspaceApi {
  return Object.freeze({
    async listWorkspaces() {
      return assertWorkspaceList(await invoke(WORKSPACE_LIST_CHANNEL));
    },
    async createWorkspace(input: CreateWorkspaceRequest) {
      const request = assertCreateWorkspaceRequest(input);
      return assertWorkspace(await invoke(WORKSPACE_CREATE_CHANNEL, request));
    },
    async getActiveWorkspace() {
      return assertOptionalWorkspace(await invoke(WORKSPACE_GET_ACTIVE_CHANNEL));
    },
    async setActiveWorkspace(id: string) {
      const request = assertSetActiveWorkspaceRequest({ id });
      return assertWorkspace(await invoke(WORKSPACE_SET_ACTIVE_CHANNEL, request));
    },
    async renameWorkspace(id: string, name: string) {
      const request = assertRenameWorkspaceRequest({ id, name });
      return assertWorkspace(await invoke(WORKSPACE_RENAME_CHANNEL, request));
    },
    async deleteWorkspace(id: string) {
      const request = assertDeleteWorkspaceRequest({ id });
      const result = await invoke(WORKSPACE_DELETE_CHANNEL, request);
      if (typeof result !== "boolean") {
        throw new TypeError("Invalid Workspace delete response");
      }

      return result;
    },
  });
}
