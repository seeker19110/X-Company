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
  // Typed lint cho mã TS (BASE-DATA-003: phân biệt thiếu/rỗng/0).
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: true,
          allowNullableBoolean: true,
          allowNullableString: false,
          allowNullableNumber: false,
          allowAny: false,
        },
      ],
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      // ARC-MOD-004: không vòng phụ thuộc (plugin import đi kèm eslint-config-next).
      "import/no-cycle": "error",
      // FE-SEC-001: DOM sink chỉ qua module safe-html, mỗi chỗ dùng phải eslint-disable kèm lý do.
      "react/no-danger": "error",
      // UX-A11Y-011: ô nhập phải có nhãn gắn chương trình.
      "jsx-a11y/label-has-associated-control": ["error", { assert: "either", depth: 3 }],
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
    // ARC-MOD-003: lõi thuần không phụ thuộc DB, driver, HTTP, framework web.
    // Gồm tệp thuần đã khai ở docs/architecture/domains.md và quy ước `*.pure.ts`, `lib/**/pure/**`.
    files: [
      "lib/attendance/compute.ts",
      "lib/work/progress.ts",
      "lib/authz/index.ts",
      "lib/offline/queue.ts",
      "lib/**/*.pure.ts",
      "lib/**/pure/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "@/app/*", "../app/*", "../../app/*"],
              message: "lib/ không import next/* hay app/ (ARCHITECTURE: luật lớp)",
            },
            {
              group: ["**/db", "**/db/*", "@/lib/db", "@/lib/db/*", "pg", "pg/*", "postgres"],
              message: "Mô-đun thuần không import lib/db hay driver pg (ARC-MOD-003)",
            },
            {
              group: ["http", "https", "node:http", "node:https", "node:http2", "undici"],
              message: "Mô-đun thuần không import HTTP client/server (ARC-MOD-003)",
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
  {
    // QA-STRAT-008: không để .only/.skip/.todo/.fixme lọt vào nhánh chính.
    files: ["tests/**/*.ts", "e2e/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.name=/^(test|it|describe|suite)$/][property.name=/^(only|skip|todo|fixme)$/]",
          message: "Cấm .only/.skip/.todo/.fixme trong test (QA-STRAT-008)",
        },
        {
          selector:
            "CallExpression[callee.name=/^(test|it|describe|suite)$/] > ObjectExpression > Property[key.name=/^(only|skip|todo)$/]",
          message: "Cấm tuỳ chọn only/skip/todo trong test (QA-STRAT-008)",
        },
        {
          selector: "CallExpression[callee.object.name='t'][callee.property.name=/^(skip|todo)$/]",
          message: "Cấm t.skip()/t.todo() trong test (QA-STRAT-008)",
        },
      ],
    },
  },
];

export default config;
