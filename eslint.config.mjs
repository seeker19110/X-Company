import nextVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

const config = [
  {
    ignores: [
      ".xtemplates/**",
      ".claude/worktrees/**", // worktree tạm của agent — không thuộc mã nguồn
      ".tools/**", // công cụ vận hành tải về (install-tool.mjs, gitignore) — gồm thư mục home của ZAP có JS bên thứ ba
      ".next/**",
      "node_modules/**",
      "coverage/**",
      ".lighthouseci/**",
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
          // Chuỗi null/"" cùng nghĩa "không có" ở điều kiện (env, ghi chú); số và boolean thì phải so sánh tường minh.
          allowNullableString: true,
          allowNullableNumber: false,
          allowAny: false,
        },
      ],
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Mọi log đi qua lib/nen/log.ts (JSON một dòng, có che bí mật) — BASE-GATE-003, BASE-ERR-005.
      "no-console": "error",
      // ARC-MOD-004: không vòng phụ thuộc (plugin import đi kèm eslint-config-next).
      "import/no-cycle": "error",
      // FE-SEC-001: DOM sink chỉ qua module safe-html, mỗi chỗ dùng phải eslint-disable kèm lý do.
      "react/no-danger": "error",
      // UX-A11Y-011: ô nhập phải có nhãn gắn chương trình.
      "jsx-a11y/label-has-associated-control": ["error", { assert: "either", depth: 3 }],
    },
  },
  {
    // BASE-ERR-001: không nuốt lỗi bằng `.catch(() => {})`; xử lý, chuyển tiếp có ngữ cảnh hoặc ghi log.
    files: ["lib/**/*.{ts,tsx}", "app/**/*.{ts,tsx}", "scripts/**/*.ts", "proxy.ts", "instrumentation.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='catch'] > :matches(ArrowFunctionExpression, FunctionExpression)[body.type='BlockStatement'][body.body.length=0]",
          message: "Không nuốt lỗi bằng .catch(() => {}) — xử lý hoặc ghi log có ngữ cảnh (BASE-ERR-001).",
        },
        {
          selector:
            "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[body.type='Identifier'][body.name='undefined']",
          message:
            "Không nuốt lỗi bằng .catch(() => undefined) — xử lý hoặc ghi log có ngữ cảnh (BASE-ERR-001).",
        },
        // AUD-XFEAT-005: múi giờ nghiệp vụ một nguồn — BUSINESS_TZ ở lib/nen/time.ts (SQL nhận qua tham số).
        {
          selector: "Literal[value=/Asia\\/Ho_Chi_Minh/]",
          message: "Không viết cứng múi giờ — dùng BUSINESS_TZ từ lib/nen/time.ts (AUD-XFEAT-005).",
        },
        {
          selector: "TemplateElement[value.raw=/Asia\\/Ho_Chi_Minh/]",
          message:
            "Không viết cứng múi giờ trong SQL/chuỗi — truyền BUSINESS_TZ qua tham số (AUD-XFEAT-005).",
        },
      ],
    },
  },
  {
    // Hàng rào: promise bị bỏ rơi (gọi hàm kiểm quyền async mà quên await → bỏ qua kiểm quyền). Cần lint có kiểu.
    files: [
      "lib/**/*.ts",
      "app/**/*.ts",
      "app/**/*.tsx",
      "tests/**/*.ts",
      "tests/**/*.tsx",
      "scripts/**/*.ts",
    ],
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
      "lib/attendance/labor-rules.ts",
      "lib/work/progress-compute.ts",
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
    // Lý do tắt (BASE-GATE-003): script CLI và test in kết quả cho người chạy ra stdout/stderr — không phải log ứng dụng.
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
        {
          // FE-TEST-001: truy vấn theo vai trò/nhãn (getByRole/getByLabel/getByText); testid chỉ khi không còn cách khác
          // — khi đó thêm eslint-disable-next-line kèm chú thích lý do.
          selector: "CallExpression[callee.property.name='getByTestId']",
          message:
            "Dùng getByRole/getByLabel thay getByTestId; bất khả kháng thì eslint-disable kèm lý do (FE-TEST-001)",
        },
      ],
    },
  },
];

export default config;
