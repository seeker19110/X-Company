-- Tệp private có phiên bản + bình luận theo đối tượng (SPEC-work F-010, AT02).
CREATE TABLE file_object (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id),
  storage_key text NOT NULL UNIQUE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  mime text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  original_name text NOT NULL,
  uploaded_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);

CREATE TABLE document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id),
  object_type text NOT NULL CHECK (object_type IN ('task', 'project')),
  object_id uuid NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);
CREATE INDEX document_object_idx ON document (object_type, object_id);

CREATE TABLE document_version (
  document_id uuid NOT NULL,
  company_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  file_id uuid NOT NULL,
  uploaded_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, version),
  FOREIGN KEY (company_id, document_id) REFERENCES document (company_id, id),
  FOREIGN KEY (company_id, file_id) REFERENCES file_object (company_id, id)
);
REVOKE UPDATE, DELETE, TRUNCATE ON document_version FROM xc_app_rw;

CREATE TABLE comment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id),
  object_type text NOT NULL CHECK (object_type IN ('task', 'project')),
  object_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comment_object_idx ON comment (object_type, object_id, created_at);
