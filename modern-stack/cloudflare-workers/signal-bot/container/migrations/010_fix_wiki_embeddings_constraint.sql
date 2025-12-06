-- Fix wiki_embeddings constraint
-- file_path should not be UNIQUE alone - each article has multiple chunks
-- The unique constraint should be on (file_path, chunk_index)

-- First, drop the incorrect unique constraint
ALTER TABLE wiki_embeddings DROP CONSTRAINT IF EXISTS wiki_embeddings_file_path_key;

-- Add the correct composite unique constraint
ALTER TABLE wiki_embeddings ADD CONSTRAINT wiki_embeddings_file_path_chunk_idx_key UNIQUE (file_path, chunk_index);

-- Clear existing data to allow clean reindex
TRUNCATE wiki_embeddings;
