-- CMS website (SPEC-website-cms F-003): trang + phiên bản (nháp → duyệt → xuất bản), chuyển hướng khi đổi slug.
CREATE TABLE cms_page (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id),
  type text NOT NULL CHECK (type IN ('home', 'about', 'service', 'project', 'capability', 'news', 'job', 'contact', 'page')),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR slug = ''),
  locale text NOT NULL DEFAULT 'vi' CHECK (locale IN ('vi', 'en')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, locale, type, slug)
);

CREATE TABLE cms_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  page_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  summary text,
  body_markdown text NOT NULL DEFAULT '' CHECK (length(body_markdown) <= 200000),
  seo_title text,
  seo_description text,
  canonical_url text,
  status text NOT NULL CHECK (status IN ('draft', 'in_review', 'approved', 'published')),
  author_user_id uuid NOT NULL,
  reviewer_user_id uuid,
  restored_from_version integer,
  publish_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, version),
  FOREIGN KEY (company_id, page_id) REFERENCES cms_page (company_id, id),
  FOREIGN KEY (company_id, author_user_id) REFERENCES app_user (company_id, id),
  FOREIGN KEY (company_id, reviewer_user_id) REFERENCES app_user (company_id, id),
  -- Người duyệt khác tác giả (R5) — chặn cả ở DB.
  CHECK (reviewer_user_id IS NULL OR reviewer_user_id <> author_user_id),
  CHECK ((status = 'published') = (publish_at IS NOT NULL))
);
CREATE INDEX cms_revision_visible_idx ON cms_revision (page_id, publish_at DESC) WHERE status = 'published';

CREATE TABLE cms_redirect (
  company_id uuid NOT NULL REFERENCES company (id),
  locale text NOT NULL,
  from_path text NOT NULL,
  to_path text NOT NULL CHECK (to_path <> from_path),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, locale, from_path)
);
