// Chữ của màn hình lỗi chung — tách riêng để ranh giới lỗi gốc chỉ kéo chuỗi lõi (FE-PERF-004).
import { t } from "@/lib/i18n/client";

export const ERROR_VIEW_TEXT = {
  title: t("errorView.title"),
  body: t("errorView.body"),
  retry: t("errorView.retry"),
} as const;
