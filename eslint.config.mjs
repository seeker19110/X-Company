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
    // Hàng rào: promise bị bỏ rơi (gọi hàm kiểm quyền async mà quên await → bỏ qua kiểm quyền). Cần lint có kiểu.
    files: ["lib/**/*.ts", "app/**/*.ts", "app/**/*.tsx", "tests/**/*.ts", "scripts/**/*.ts"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            {
              from: "package",
              package: "node:test",
              name: ["describe", "test", "it", "before", "after", "beforeEach", "afterEach", "suite"],
            },
          ],
        },
      ],
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/await-thenable": "error",
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
    files: ["scripts/**/*.ts", "scripts/**/*.mjs", "tests/**/*.ts"],
    rules: { "no-console": "off" },
  },
];

export default config;
