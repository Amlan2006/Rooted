CREATE TABLE analyst_briefs (
 network TEXT NOT NULL CHECK(network='sepolia'),
 block_hash TEXT NOT NULL,
 block_number BIGINT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 triggers JSONB NOT NULL,
 brief TEXT NOT NULL,
 evidence JSONB NOT NULL,
 model TEXT NOT NULL,
 usd NUMERIC NOT NULL CHECK(usd>=0),
 PRIMARY KEY(network,block_hash)
);
CREATE INDEX analyst_briefs_created ON analyst_briefs(network,created_at DESC);
