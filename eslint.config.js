/* Note: do not add eslint-disable comments referencing plugin rules at the top
   because the plugin is configured later in the flat config and ESLint may
   report unknown-rule errors during initial parsing. */
const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "**/dist/**",
      "**/test/*.d.ts",
      "**/test/*.js",
      "**/test/*.js.map",
      "**/*.tsbuildinfo",
      "*.tsbuildinfo",
    ],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
        ecmaVersion: 2022,
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-console": "warn",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];
