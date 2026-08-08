import { describe, expect, it } from "vitest";

import { ALPHA_FEATURE_FLAGS, FEATURE_FLAG_NAMES, isFeatureFlags } from "../src/index";

describe("Alpha feature flags", () => {
  it("disables every initial feature", () => {
    expect(ALPHA_FEATURE_FLAGS).toEqual({
      internetResearch: false,
      paidResearch: false,
      externalAiProviders: false,
      cloudSync: false,
      communityPackages: false,
      automaticPackageUpdates: false,
      cameraAnalysis: false,
      multiUser: false,
    });
    expect(FEATURE_FLAG_NAMES.every((name) => !ALPHA_FEATURE_FLAGS[name])).toBe(true);
  });

  it("keeps the Alpha defaults immutable", () => {
    expect(Object.isFrozen(ALPHA_FEATURE_FLAGS)).toBe(true);
  });

  it("validates the complete feature flag shape", () => {
    expect(isFeatureFlags(ALPHA_FEATURE_FLAGS)).toBe(true);
    expect(isFeatureFlags({ ...ALPHA_FEATURE_FLAGS, unexpected: false })).toBe(false);
    expect(isFeatureFlags({ ...ALPHA_FEATURE_FLAGS, internetResearch: "false" })).toBe(false);
  });
});
