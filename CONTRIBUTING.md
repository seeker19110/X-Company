# Đóng góp cho X-Company

Cảm ơn bạn đã quan tâm. Dự án độc quyền (xem [LICENSE](LICENSE)): đóng góp từ bên ngoài chỉ nhận khi chủ dự án
[@seeker19110](https://github.com/seeker19110) đồng ý trước bằng issue. Mọi người tham gia theo [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
**Lỗ hổng bảo mật: không mở issue/PR công khai** — theo [SECURITY.md](SECURITY.md).

## Trước khi bắt đầu

1. Có issue với nhãn `ready` (checklist Definition of Ready trong mẫu issue đã đủ). Chưa Ready thì hỏi trong issue, chưa code.
2. Đọc spec liên quan ở [docs/specs/](docs/specs/) và [docs/design/ARCHITECTURE.md](docs/design/ARCHITECTURE.md) (luật lớp: route → `withActor` → `lib/`; `can()` ở server; ghi nghiệp vụ kèm audit trong cùng giao dịch).
3. Cài môi trường theo [README.md](README.md).

## Nhánh

- `main` được bảo vệ (ruleset ở [.github/rulesets/main.json](.github/rulesets/main.json)): không push thẳng, không force-push, chỉ squash merge qua PR.
- Mỗi lát việc một nhánh, một PR. Đặt tên: `<loại>/<mô-tả-ngắn>` — `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`, `test/`; có thể thêm mã task (`feat/t-012-su-kien-cong`).
- Không rewrite lịch sử nhánh người khác đang dùng; chỉ rebase/amend nhánh cá nhân chưa chia sẻ.

## Commit — Conventional Commits 1.0.0

`type(scope)!: mô tả` — tiếng Việt có dấu, subject ≤ 72 ký tự, `BREAKING CHANGE:` ở footer khi vỡ tương thích. Loại thường dùng:
`feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `perf`. Thay đổi phạm vi MVP: `docs(scope): …` nêu mục bị đổi
(xem [SCOPE.md](SCOPE.md)). Commit nhỏ, đảo ngược được.

## Cổng — chạy trước khi mở PR

```bash
.xtemplates/scripts/dev-task.sh gate   # build · typecheck · lint · test
npm run -s coverage                    # ngưỡng coverage
npm run -s check:repo-docs && npm run -s check:docs
```

- Test DB chạy trên PostgreSQL thật, không bao giờ skip. Sửa bug: viết test tái hiện (đỏ) trước, sửa (xanh) sau.
- Mỗi nhánh nghiệp vụ phức tạp có ≥ 1 test ca biên (rỗng/null so với 0, trùng/idempotency, song song, múi giờ UTC, quyền).
- Không nới cổng cho xanh: không skip/disable test, không hạ ngưỡng, không sửa migration đã áp. Thay đổi lint/tsconfig/CI/hook đi PR riêng, nêu lý do.
- Migration mới: tệp `migrations/NNNN_*.sql` đánh số tiếp, append-only, có đường lùi; cột chứa dữ liệu cá nhân phải khai trong
  [docs/privacy/data-map.yaml](docs/privacy/data-map.yaml) và [docs/compliance/data-inventory.csv](docs/compliance/data-inventory.csv).
- Không bí mật, không dữ liệu cá nhân thật trong mã/test/log; email test dùng `@example.test`/`@example.com`
  ([chính sách dữ liệu test](docs/compliance/test-data-policy.md)).

## Pull request

Điền [mẫu PR](.github/pull_request_template.md): mô tả, task (T-NNN), spec/AC liên quan, bằng chứng (lệnh + kết quả), rủi ro.
PR đổi vùng nhạy cảm (auth, quyền, mật mã, bí mật, PII, migration, `.github/`, `.claude/`) cần chủ dự án review — xem
[.github/CODEOWNERS](.github/CODEOWNERS). PR ngoại lệ cứng do người merge (xem AGENTS.md §6–7). Merge **squash**; tiêu đề PR theo Conventional Commits.

## Cập nhật tài liệu

Đổi hành vi thì cập nhật spec, [CHANGELOG.md](CHANGELOG.md) (mục `Unreleased`) và tài liệu liên quan trong cùng PR.
