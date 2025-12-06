-- Wiki Embeddings for Semantic Search
-- Stores pre-computed embeddings for wiki articles
-- Uses JSON array since pgvector not available

CREATE TABLE IF NOT EXISTS wiki_embeddings (
    id SERIAL PRIMARY KEY,
    file_path TEXT UNIQUE NOT NULL,           -- docs/security/hardening.md
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    content_hash TEXT NOT NULL,               -- MD5 of content to detect changes
    embedding JSONB NOT NULL,                 -- Vector as JSON array [0.1, 0.2, ...]
    chunk_index INTEGER DEFAULT 0,            -- For multi-chunk articles
    chunk_text TEXT,                          -- The actual chunk text
    metadata JSONB DEFAULT '{}',              -- tags, category, etc.
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup by file path
CREATE INDEX IF NOT EXISTS idx_wiki_embeddings_file_path ON wiki_embeddings(file_path);

-- Index for finding outdated embeddings
CREATE INDEX IF NOT EXISTS idx_wiki_embeddings_content_hash ON wiki_embeddings(content_hash);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_wiki_embeddings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wiki_embeddings_updated_at ON wiki_embeddings;
CREATE TRIGGER wiki_embeddings_updated_at
    BEFORE UPDATE ON wiki_embeddings
    FOR EACH ROW
    EXECUTE FUNCTION update_wiki_embeddings_timestamp();

-- Table to track embedding generation status
CREATE TABLE IF NOT EXISTS wiki_embedding_status (
    id SERIAL PRIMARY KEY,
    last_full_index TIMESTAMPTZ,
    articles_indexed INTEGER DEFAULT 0,
    last_error TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert initial status row
INSERT INTO wiki_embedding_status (last_full_index, articles_indexed)
VALUES (NULL, 0)
ON CONFLICT DO NOTHING;
