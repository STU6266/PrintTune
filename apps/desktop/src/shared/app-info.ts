export const APP_INFO_CHANNEL = "app:get-info" as const;

export interface AppInfo {
  name: string;
  version: string;
}

export interface AppInfoApi {
  getAppInfo(): Promise<AppInfo>;
}

export function isAppInfo(value: unknown): value is AppInfo {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 2 &&
    typeof candidate.name === "string" &&
    typeof candidate.version === "string"
  );
}

export function assertAppInfo(value: unknown): AppInfo {
  if (!isAppInfo(value)) {
    throw new TypeError("Invalid app info response");
  }

  return value;
}
