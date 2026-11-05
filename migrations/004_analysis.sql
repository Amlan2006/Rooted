CREATE TABLE analysis_runs (
 id TEXT PRIMARY KEY,network TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('live','fork','captured','synthetic')),
 block_hash TEXT NOT NULL,block_number NUMERIC(20,0) NOT NULL,
 first_seen TIMESTAMPTZ NOT NULL,last_seen TIMESTAMPTZ NOT NULL,result JSONB NOT NULL
);
CREATE INDEX analysis_blocks ON analysis_runs(network,mode,block_hash,last_seen DESC);
CREATE TABLE analysis_raw (
 run_id TEXT NOT NULL REFERENCES analysis_runs(id),kind TEXT NOT NULL,origin TEXT NOT NULL,digest TEXT NOT NULL,
 body JSONB NOT NULL,first_seen TIMESTAMPTZ NOT NULL,last_seen TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(run_id,kind,origin,digest)
);
CREATE TABLE analysis_versions (
 run_id TEXT NOT NULL REFERENCES analysis_runs(id),digest TEXT NOT NULL,result JSONB NOT NULL,observed_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(run_id,digest)
);
