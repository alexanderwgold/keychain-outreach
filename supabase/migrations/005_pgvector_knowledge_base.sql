-- ============================================================
-- Migration 005: pgvector extension + knowledge_base table
-- Unified vector store for Metabase data, web research, and collateral.
-- Insert-only design: re-imports delete + re-insert via upsert index.
-- ============================================================

-- Enable pgvector in the extensions schema
create extension if not exists vector with schema extensions;

-- Source type enum
create type knowledge_source as enum (
  'metabase_report',
  'web_research',
  'collateral'
);

-- Unified knowledge base with vector embeddings
create table knowledge_base (
  id          uuid primary key default gen_random_uuid(),
  source_type knowledge_source not null,
  source_id   text not null,
  account_name text,
  content     text not null,
  embedding   extensions.vector(384) not null,
  metadata    jsonb default '{}'::jsonb,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- Indexes
create index knowledge_base_account_name_idx on knowledge_base (account_name);
create index knowledge_base_source_type_idx on knowledge_base (source_type);
create index knowledge_base_expires_at_idx on knowledge_base (expires_at) where expires_at is not null;

-- HNSW index for vector similarity search (faster than IVFFlat for < 1M rows)
create index knowledge_base_embedding_idx on knowledge_base
  using hnsw (embedding extensions.vector_cosine_ops);

-- Upsert support: unique constraint for replacing old data on re-import
create unique index knowledge_base_source_account_idx
  on knowledge_base (source_type, source_id, account_name)
  where account_name is not null;

-- Enable RLS (Edge Functions bypass via service role key)
alter table knowledge_base enable row level security;

-- RPC function for vector similarity search
-- Runs as caller; Edge Functions connect as service role
create or replace function search_knowledge(
  query_embedding extensions.vector(384),
  match_account_name text default null,
  match_threshold float default 0.3,
  match_count int default 10
)
returns table (
  id uuid,
  source_type knowledge_source,
  source_id text,
  account_name text,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    kb.id,
    kb.source_type,
    kb.source_id,
    kb.account_name,
    kb.content,
    kb.metadata,
    1 - (kb.embedding <=> query_embedding) as similarity
  from knowledge_base kb
  where
    (match_account_name is null or kb.account_name = match_account_name)
    and (kb.expires_at is null or kb.expires_at > now())
    and kb.embedding <=> query_embedding < (1 - match_threshold)
  order by kb.embedding <=> query_embedding
  limit match_count;
end;
$$;
