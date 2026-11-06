CREATE TABLE xray_reports (
 block_hash TEXT PRIMARY KEY,
 network TEXT NOT NULL CHECK(network='sepolia'),
 block_number BIGINT NOT NULL,
 slot BIGINT,
 source TEXT NOT NULL CHECK(source IN ('live','profile','capture','follow')),
 computed_at TIMESTAMPTZ NOT NULL,
 profile_id TEXT,
 brief JSONB NOT NULL,
 report JSONB NOT NULL
);
CREATE INDEX xray_reports_number ON xray_reports(network,block_number DESC);
