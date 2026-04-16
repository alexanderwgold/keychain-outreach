-- ============================================================
-- Migration 005: pgvector extension + knowledge_base table
-- Unified vector store for Metabase data, web research, and collateral.
-- ============================================================

-- Enable pgvector in the extensions schema
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Source type enum
CREATE TYPE knowledge_source AS ENUM (
  'metabase_report',
  'web_research',
  'collateral'
);

-- Unified knowledge base with vector embeddings
CREATE TABLE knowledge_base (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type knowledge_source NOT NULL,
  source_id   TEXT NOT NULL,
  account_name TEXT,
  content     TEXT NOT NULL,
  embedding   extensions.vector(384) NOT NULL,
  metadata    JSONB DEFAULT '{}'::jsonb,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX knowledge_base_account_name_idx ON knowledge_base (account_name);
CREATE INDEX knowledge_base_source_type_idx ON knowledge_base (source_type);
CREATE INDEX knowledge_base_expires_at_idx ON knowledge_base (expires_at) WHERE expires_at IS NOT NULL;

-- HNSW index for vector similarity search (faster than IVFFlat for < 1M rows)
CREATE INDEX knowledge_base_embedding_idx ON knowledge_base
  USING hnsw (embedding extensions.vector_cosine_ops);

-- Upsert support: unique constraint for replacing old data on re-import
CREATE UNIQUE INDEX knowledge_base_source_account_idx
  ON knowledge_base (source_type, source_id, account_name)
  WHERE account_name IS NOT NULL;

-- Enable RLS (Edge Functions bypass via service role key)
ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;

-- RPC function for vector similarity search
CREATE OR REPLACE FUNCTION search_knowledge(
  query_embedding extensions.vector(384),
  match_account_name TEXT DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  source_type knowledge_source,
  source_id TEXT,
  account_name TEXT,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kb.id,
    kb.source_type,
    kb.source_id,
    kb.account_name,
    kb.content,
    kb.metadata,
    1 - (kb.embedding <=> query_embedding) AS similarity
  FROM knowledge_base kb
  WHERE
    (match_account_name IS NULL OR kb.account_name = match_account_name)
    AND (kb.expires_at IS NULL OR kb.expires_at > now())
    AND 1 - (kb.embedding <=> query_embedding) > match_threshold
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
