-- DB-PERF-005: timeout ở mức VAI TRÒ ứng dụng (không đặt toàn cục trong postgresql.conf).
-- Lưu ý PostgreSQL: cài đặt của vai trò chỉ có hiệu lực cho vai trò ĐĂNG NHẬP — vai trò nhóm NOLOGIN (xc_app_rw) không
-- truyền xuống thành viên. Vì vậy đặt cho nhóm (tài liệu/đăng nhập trực tiếp) và cho mọi vai trò đăng nhập đang là thành
-- viên của nó. Vai trò đăng nhập tạo SAU migration này: DBA chạy lại hai lệnh ALTER ROLE (docs/db/connections.md).
-- Pool ứng dụng còn gửi cùng giá trị lúc bắt tay kết nối (lib/db PG_SESSION_OPTIONS) nên không phụ thuộc thứ tự này.
-- Idempotent: chạy lại cho cùng kết quả (ALTER ROLE … SET ghi đè).
ALTER ROLE xc_app_rw SET statement_timeout = '30s';
ALTER ROLE xc_app_rw SET idle_in_transaction_session_timeout = '60s';

DO $$
DECLARE
  member name;
BEGIN
  FOR member IN
    SELECT m.rolname
    FROM pg_auth_members am
    JOIN pg_roles g ON g.oid = am.roleid AND g.rolname = 'xc_app_rw'
    JOIN pg_roles m ON m.oid = am.member
    WHERE m.rolcanlogin AND NOT m.rolsuper
  LOOP
    EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', member, '30s');
    EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout = %L', member, '60s');
  END LOOP;
END
$$;
