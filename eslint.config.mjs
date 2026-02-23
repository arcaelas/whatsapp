import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-unused-vars": "off",
      "no-var": "warn",
      "prefer-const": "warn",
      "no-constant-binary-expression": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_", "ignoreRestSiblings": true }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unnecessary-type-constraint": "warn",
    },
  },
  {
    ignores: ["build/", "node_modules/", "docs/"],
  },
];
