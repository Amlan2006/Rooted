CREATE TABLE execution_profiles (
 id TEXT PRIMARY KEY,
 network TEXT NOT NULL CHECK(network='sepolia'),
 mode TEXT NOT NULL CHECK(mode='replay'),
 block_hash TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL,
 result JSONB NOT NULL,
 capture_gzip BYTEA NOT NULL
);
CREATE INDEX execution_profile_blocks ON execution_profiles(network,block_hash,created_at DESC);
