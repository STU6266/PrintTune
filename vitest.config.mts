import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["{apps,packages}/**/test/**/*.test.ts"],
  },
});
