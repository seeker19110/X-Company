import nextVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

const config = [
  {
    ignores: [
      ".xtemplates/**",
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      "public/sw.js",
    ],
  },
  ...nextVitals,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // Luật lớp (docs/design/ARCHITECTURE.md): lib/ không phụ thuộc Next hay app/.
    files: ["lib/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "@/app/*", "../app/*", "../../app/*"],
              message: "lib/ không import next/* hay app/ (ARCHITECTURE: luật lớp)",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.ts", "tests/**/*.ts"],
    rules: { "no-console": "off" },
  },
];

export default config;
