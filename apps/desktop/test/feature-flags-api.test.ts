import { ALPHA_FEATURE_FLAGS } from "@printtune/contracts";
import { describe, expect, it, vi } from "vitest";

import { FEATURE_FLAGS_CHANNEL, createFeatureFlagsApi } from "../src/shared/feature-flags-api";

describe("feature flags preload API", () => {
  it("uses the fixed channel and returns an immutable validated copy", async () => {
    const invoke = vi.fn().mockResolvedValue(ALPHA_FEATURE_FLAGS);
    const api = createFeatureFlagsApi(invoke);

    const flags = await api.getFeatureFlags();

    expect(invoke).toHaveBeenCalledExactlyOnceWith(FEATURE_FLAGS_CHANNEL);
    expect(flags).toEqual(ALPHA_FEATURE_FLAGS);
    expect(flags).not.toBe(ALPHA_FEATURE_FLAGS);
    expect(Object.isFrozen(flags)).toBe(true);
  });

  it("rejects an invalid IPC response", async () => {
    const api = createFeatureFlagsApi(async () => ({ internetResearch: false }));

    await expect(api.getFeatureFlags()).rejects.toThrow(TypeError);
  });
});
