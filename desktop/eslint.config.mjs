import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const LEGACY_DEBT_RULES = {
  "@typescript-eslint/no-explicit-any": "off",
  "@typescript-eslint/no-require-imports": "off",
  "react-hooks/exhaustive-deps": "off",
  "react/no-unescaped-entities": "off",
};

const eslintConfig = [
  {
    ignores: [".next/**", "out/**", "node_modules/**"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      ...LEGACY_DEBT_RULES,
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "prefer-const": "error",
    },
  },
];

export default eslintConfig;
