import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../../lib/nen/app-error.ts";

test("AppError giữ mã, HTTP status và chi tiết", () => {
  const e = new AppError("SELF_APPROVAL", 409, "Không thể tự duyệt đơn của mình", { id: "x" });
  assert.equal(e.code, "SELF_APPROVAL");
  assert.equal(e.status, 409);
  assert.deepEqual(e.details, { id: "x" });
  assert.ok(e instanceof Error);
  assert.equal(e.name, "AppError");
});
