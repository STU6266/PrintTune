import { assertFeatureFlags, type FeatureFlags } from "@printtune/contracts";

export const FEATURE_FLAGS_CHANNEL = "feature-flags:get" as const;

export interface FeatureFlagsApi {
  getFeatureFlags(): Promise<FeatureFlags>;
}

type FeatureFlagsInvoke = (channel: typeof FEATURE_FLAGS_CHANNEL) => Promise<unknown>;

export function createFeatureFlagsApi(invoke: FeatureFlagsInvoke): FeatureFlagsApi {
  return Object.freeze({
    async getFeatureFlags() {
      const flags = assertFeatureFlags(await invoke(FEATURE_FLAGS_CHANNEL));
      return Object.freeze({ ...flags });
    },
  });
}
