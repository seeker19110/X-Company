// OPS-DEPLOY-003: scripts/test-prev-release.sh chọn đúng bản phát hành trước (N−1) — kể cả trên Release PR (manifest đã
// nâng, tag chưa có) và commit phát hành trên main (tag trỏ chính HEAD) — review #91 🔴.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const SCRIPT = path.resolve("scripts/test-prev-release.sh");
const dirs: string[] = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/** Repo tạm: v0.1.0 (1 migration) → v0.2.0 (2 migration); trả đường dẫn. */
function repo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xc-n1-"));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  mkdirSync(path.join(dir, "migrations"));
  const release = (v: string, mig: string) => {
    writeFileSync(path.join(dir, ".release-please-manifest.json"), JSON.stringify({ ".": v }));
    writeFileSync(path.join(dir, "migrations", mig), "SELECT 1;\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", `release ${v}`);
    git(dir, "tag", `v${v}`);
  };
  release("0.1.0", "0001_a.sql");
  release("0.2.0", "0002_b.sql");
  return dir;
}

function resolve(dir: string) {
  return spawnSync("bash", [SCRIPT, "--resolve-only"], { cwd: dir, encoding: "utf8" });
}

function bumpManifest(dir: string, v: string) {
  writeFileSync(path.join(dir, ".release-please-manifest.json"), JSON.stringify({ ".": v }));
  git(dir, "commit", "-q", "-am", `chore: release ${v}`);
}

describe("test-prev-release.sh chọn tag N−1", () => {
  test("PR thường: tag theo manifest HEAD (đã phát hành, là tổ tiên)", () => {
    const dir = repo();
    writeFileSync(path.join(dir, "x.txt"), "x");
    git(dir, "add", "x.txt");
    git(dir, "commit", "-q", "-m", "feat: x");
    const r = resolve(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "v0.2.0");
  });

  test("Release PR: manifest đã nâng nhưng chưa có tag → manifest của HEAD^1", () => {
    const dir = repo();
    bumpManifest(dir, "0.3.0");
    const r = resolve(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "v0.2.0");
  });

  test("commit phát hành trên main đã gắn tag (tag = HEAD) → bản trước, không chạy N trên N", () => {
    const dir = repo();
    bumpManifest(dir, "0.3.0");
    git(dir, "tag", "v0.3.0");
    const r = resolve(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "v0.2.0");
  });

  test("migration đã phát hành bị sửa ở cây làm việc → đỏ (không chạy test)", () => {
    const dir = repo();
    writeFileSync(path.join(dir, "migrations", "0001_a.sql"), "SELECT 2;\n");
    const r = spawnSync("bash", [SCRIPT], { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /migration đã phát hành bị sửa\/xoá: migrations\/0001_a\.sql/);
  });

  test("tag chỉ định không tồn tại → exit 2", () => {
    const dir = repo();
    const r = spawnSync("bash", [SCRIPT, "--resolve-only", "v9.9.9"], { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 2);
  });
});
