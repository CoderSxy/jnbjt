-- Knowledge base: sources, drafts, published facts (isolated jnbjt database)
-- schema_migrations is owned by scripts/migrate.ts

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS source_pages (
  id TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  license TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_snapshots (
  id TEXT PRIMARY KEY,
  source_page_id TEXT NOT NULL REFERENCES source_pages(id),
  revision INTEGER,
  content_hash TEXT NOT NULL,
  html TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  parser_version TEXT,
  robots_allowed BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS knowledge_imports (
  id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('staged', 'rejected', 'published')),
  report JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_versions (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES knowledge_imports(id),
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_versions_one_active
  ON knowledge_versions ((is_active))
  WHERE is_active;

CREATE TABLE IF NOT EXISTS building_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  knowledge_version_id TEXT NOT NULL REFERENCES knowledge_versions(id),
  UNIQUE (knowledge_version_id, name)
);

CREATE TABLE IF NOT EXISTS building_variants (
  id TEXT PRIMARY KEY,
  building_type_id TEXT NOT NULL REFERENCES building_types(id) ON DELETE CASCADE,
  city TEXT,
  UNIQUE (building_type_id, city)
);

CREATE TABLE IF NOT EXISTS production_recipes (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES building_variants(id) ON DELETE CASCADE,
  tier TEXT,
  duration_seconds INTEGER,
  duration_unknown BOOLEAN NOT NULL DEFAULT false,
  workers INTEGER,
  workers_unknown BOOLEAN NOT NULL DEFAULT false,
  inputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  outputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_cells JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmation TEXT NOT NULL DEFAULT 'draft',
  manual_override BOOLEAN NOT NULL DEFAULT false,
  snapshot_id TEXT REFERENCES source_snapshots(id)
);

CREATE TABLE IF NOT EXISTS entity_aliases (
  id TEXT PRIMARY KEY,
  building_type_id TEXT NOT NULL REFERENCES building_types(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  city TEXT,
  UNIQUE (building_type_id, alias, city)
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  knowledge_version_id TEXT NOT NULL REFERENCES knowledge_versions(id) ON DELETE CASCADE,
  entity_name TEXT NOT NULL,
  city TEXT,
  heading TEXT NOT NULL,
  body TEXT NOT NULL,
  snapshot_id TEXT,
  building_type_id TEXT REFERENCES building_types(id)
);

CREATE TABLE IF NOT EXISTS entity_evidence (
  id TEXT PRIMARY KEY,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  snapshot_id TEXT,
  manual_override BOOLEAN NOT NULL DEFAULT false,
  value_json JSONB,
  UNIQUE (entity_kind, entity_id, field_path)
);

CREATE INDEX IF NOT EXISTS building_types_name_trgm ON building_types USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS entity_aliases_alias_trgm ON entity_aliases USING gin (alias gin_trgm_ops);
CREATE INDEX IF NOT EXISTS knowledge_chunks_body_trgm ON knowledge_chunks USING gin (body gin_trgm_ops);
