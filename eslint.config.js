// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "target/**",
      "src-tauri/**",
      "node_modules/**",
      "coverage/**",
      ".claude/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
      parserOptions: {
        projectService: { allowDefaultProject: ["*.config.js", "*.config.ts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-explicit-any": "error",
      // CSS modules are index signatures; bracket access is the honest form there.
      "@typescript-eslint/dot-notation": ["error", { allowIndexSignaturePropertyAccess: true }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@tauri-apps/api/core",
              message: "Components never call invoke directly; add a wrapper in src/ipc/.",
            },
            {
              name: "@tauri-apps/api/event",
              message:
                "Components never listen to events directly; add a wrapper in src/ipc/events.ts.",
            },
            {
              name: "lucide-react",
              message: "Import icons from src/lib/icons.ts (named re-exports only).",
            },
          ],
          patterns: [
            {
              group: ["lucide-react/*"],
              message: "No deep imports from lucide-react; use named imports in src/lib/icons.ts.",
            },
          ],
        },
      ],
    },
  },
  {
    // Only the IPC core talks to Tauri.
    files: ["src/ipc/core.ts", "src/ipc/events.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // The one place that imports lucide-react; everything else imports from here.
    files: ["src/lib/icons.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ group: ["lucide-react/*"], message: "No deep imports from lucide-react." }],
        },
      ],
    },
  },
  {
    files: ["src/**/*.test.{ts,tsx}", "src/test/**"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      // Tests mock the Tauri bridge and reject with plain AppError objects on purpose.
      "no-restricted-imports": "off",
      "@typescript-eslint/prefer-promise-reject-errors": "off",
    },
  },
  {
    files: ["*.config.{js,ts}"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "@typescript-eslint/no-unsafe-assignment": "off" },
  },
  prettier,
);
