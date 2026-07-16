// @author kongweiguang

import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const typescriptFiles = [
  "src/**/*.{ts,tsx}",
  "tests/frontend/**/*.{ts,tsx}",
  "vite.config.ts",
  "vitest.config.ts",
];

export default tseslint.config(
  {
    ignores: [
      ".codegraph/**",
      ".updeng/**",
      "dist/**",
      "node_modules/**",
      "src-tauri/**",
      "target*/**",
    ],
  },
  {
    ...eslint.configs.recommended,
    files: typescriptFiles,
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: typescriptFiles,
  })),
  {
    files: typescriptFiles,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          disallowTypeAnnotations: false,
          fixStyle: "separate-type-imports",
          prefer: "type-imports",
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
);
