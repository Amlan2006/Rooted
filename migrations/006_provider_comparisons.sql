CREATE TABLE provider_comparisons (
 id TEXT PRIMARY KEY,
 network TEXT NOT NULL,
 block_hash TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL,
 result JSONB NOT NULL
);
CREATE INDEX provider_comparison_scope ON provider_comparisons(network, block_hash, created_at DESC);
