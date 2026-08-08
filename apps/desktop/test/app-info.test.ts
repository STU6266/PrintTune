import { describe, expect, it } from "vitest";

import { assertAppInfo, isAppInfo } from "../src/shared/app-info";

describe("app info contract", () => {
  it("accepts the narrow app info response", () => {
    const value = { name: "PrintTune", version: "0.0.1" };

    expect(isAppInfo(value)).toBe(true);
    expect(assertAppInfo(value)).toEqual(value);
  });

  it.each([
    null,
    {},
    { name: "PrintTune" },
    { name: "PrintTune", version: 1 },
    { name: "PrintTune", version: "0.0.1", extra: true },
  ])("rejects an invalid response: %j", (value) => {
    expect(isAppInfo(value)).toBe(false);
    expect(() => assertAppInfo(value)).toThrow(TypeError);
  });
});
