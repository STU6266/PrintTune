export const FEATURE_FLAG_NAMES = [
  "internetResearch",
  "paidResearch",
  "externalAiProviders",
  "cloudSync",
  "communityPackages",
  "automaticPackageUpdates",
  "cameraAnalysis",
  "multiUser",
] as const;

export type FeatureFlagName = (typeof FEATURE_FLAG_NAMES)[number];

export type FeatureFlags = Readonly<Record<FeatureFlagName, boolean>>;

export const ALPHA_FEATURE_FLAGS: FeatureFlags = Object.freeze({
  internetResearch: false,
  paidResearch: false,
  externalAiProviders: false,
  cloudSync: false,
  communityPackages: false,
  automaticPackageUpdates: false,
  cameraAnalysis: false,
  multiUser: false,
});

export function isFeatureFlags(value: unknown): value is FeatureFlags {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === FEATURE_FLAG_NAMES.length &&
    FEATURE_FLAG_NAMES.every((name) => typeof candidate[name] === "boolean")
  );
}

export function assertFeatureFlags(value: unknown): FeatureFlags {
  if (!isFeatureFlags(value)) {
    throw new TypeError("Invalid feature flags response");
  }

  return value;
}
