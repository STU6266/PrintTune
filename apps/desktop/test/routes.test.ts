import { describe, expect, it } from "vitest";

import {
  APP_ROUTES,
  DEFAULT_ROUTE,
  UNKNOWN_ROUTE_REDIRECT,
  getNavigationClassName,
} from "../src/renderer/routes";

describe("desktop routes", () => {
  it("defines the five German navigation destinations", () => {
    expect(APP_ROUTES.map(({ path, label }) => ({ path, label }))).toEqual([
      { path: "/", label: "Übersicht" },
      { path: "/printers", label: "Drucker" },
      { path: "/knowledge", label: "Wissensbasis" },
      { path: "/chat", label: "Assistent" },
      { path: "/settings", label: "Einstellungen" },
    ]);
  });

  it("uses Übersicht as the default and unknown-route fallback", () => {
    expect(DEFAULT_ROUTE).toBe("/");
    expect(UNKNOWN_ROUTE_REDIRECT).toBe(DEFAULT_ROUTE);
  });

  it("marks only active navigation links with the active class", () => {
    expect(getNavigationClassName(true)).toContain("navigation-link-active");
    expect(getNavigationClassName(false)).toBe("navigation-link");
  });
});
