import js from "@eslint/js";
import tseslintParser from "@typescript-eslint/parser";
import tseslintPlugin from "@typescript-eslint/eslint-plugin";

export default [
  js.configs.recommended,
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslintPlugin,
    },
    rules: {
      ...tseslintPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "no-undef": "off" // TypeScript handles this
    },
  },
  {
    files: ["tests/**/*.ts", "src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "no-extra-boolean-cast": "off",
      "no-prototype-builtins": "off",
      "no-useless-assignment": "off",
      "no-constant-condition": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "preserve-caught-error": "off",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**"]
  }
];
