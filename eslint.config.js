import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const forbiddenInPure = {
  patterns: [
    {
      group: ["react", "react-dom", "react-dom/*", "react-router*"],
      message: "Pure packages must not import UI code.",
    },
    {
      group: ["cloudflare:*", "@cloudflare/*", "node:http*", "node:net"],
      message: "Pure packages must not import runtime/network code.",
    },
    { group: ["@uno/web", "@uno/worker"], message: "Packages cannot depend on apps." },
  ],
};

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.wrangler/**", "node_modules/**", "docs/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ["packages/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...forbiddenInPure.patterns,
            { group: ["@uno/*"], message: "shared has no workspace deps." },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...forbiddenInPure.patterns,
            { group: ["@uno/bots"], message: "engine depends only on shared." },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/bots/**/*.ts"],
    rules: { "no-restricted-imports": ["error", forbiddenInPure] },
  },
);
