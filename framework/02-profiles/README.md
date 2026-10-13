---
title: Hồ sơ loại phần mềm
kind: index
updated: 2026-10-13
---

# 02 — Hồ sơ loại phần mềm

> Chọn **đúng một** hồ sơ chính khi `compose`. Hồ sơ = kiến trúc tham chiếu + stack mặc định + checklist đặc thù + cổng tương đương.

| Slug | Hồ sơ | Dùng khi |
|---|---|---|
| `web-app` | [Ứng dụng web](web-app.md) | Có UI trong trình duyệt **và** trạng thái phía server (tài khoản, CRUD, thanh toán, realtime nhẹ). Mặc định khi phân vân. |
| `mobile-app` | [Ứng dụng di động (iOS/Android, native & cross-platform)](mobile-app.md) | Phát hành qua App Store/Play; cần push, offline sâu, camera/sensor nền, biometrics; ký store, OTA có ký, a11y theo nền tảng. |
| `desktop-app` | [Ứng dụng desktop (Electron/Tauri/native)](desktop-app.md) | Cài trên Windows/macOS/Linux, truy cập tệp/phần cứng/OS; cần ký mã (Authenticode/notarize), auto-update có ký, sandbox IPC. |
| `static-site` | [Site nội dung tĩnh / tài liệu / landing](static-site.md) | Nội dung theo chu kỳ biên tập, không đăng nhập; build ra file tĩnh lên CDN; cổng là link check, CWV, SEO, CSP qua header hosting. |
| `api-service` | [Backend / API / dịch vụ](api-service.md) | (đang viết) |
| `cli-tool` | [Công cụ dòng lệnh](cli-tool.md) | Chạy trong terminal bởi người, script, CI hay AI agent; hợp đồng là argv/stdin/stdout/exit code; cài qua checksum/chữ ký. |
| `library-sdk` | [Thư viện / SDK / package](library-sdk.md) | Mã được người khác `import` (npm/PyPI/crates/nội bộ); sản phẩm là API surface + types + semver; publish qua OIDC có provenance. |
| `data-ml` | [Data pipeline / ML system](data-ml.md) | (đang viết) |
| `ai-agent` | [AI agent (một agent, có tool, có người giám sát)](ai-agent.md) | (đang viết) |
| `agentic-system` | [Hệ agentic (đa agent, tự trị có giới hạn, chạy dài)](agentic-system.md) | (đang viết) |
| `game` | [Game (client, server, live-ops)](game.md) | (đang viết) |
| `blockchain` | [Blockchain / smart contract / dApp](blockchain.md) | (đang viết) |
| `embedded-iot` | [Nhúng / IoT / firmware](embedded-iot.md) | (đang viết) |
| `monorepo` | [Monorepo nhiều thành phần (web + mobile + API)](monorepo.md) | ≥ 2 thành phần triển khai riêng chia sẻ code trong một repo; thêm ranh giới package, build graph/cache, Changesets, CODEOWNERS, CI affected — mỗi app vẫn ghép hồ sơ riêng. |
