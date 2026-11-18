import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([".next/**", "node_modules/**", "coverage/**", "out/**", "playwright-report/**", "test-results/**"]),
  {
    rules: {
      // Lexical node overrides must keep the upstream signature even when a
      // parameter is unused, so `_`-prefixed arguments are intentional.
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
    },
  },
  {
    // Canvas and data-URL previews cannot go through next/image optimisation.
    files: ["src/components/**/*.tsx"],
    rules: { "@next/next/no-img-element": "off" },
  },
]);
