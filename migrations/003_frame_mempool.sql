CREATE TABLE frame_nodes (
 network TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('live','captured','synthetic')), node_id TEXT NOT NULL,
 chain_id TEXT NOT NULL, genesis_hash TEXT NOT NULL, boot_id TEXT NOT NULL,
 info JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
 poll_status TEXT NOT NULL DEFAULT 'not_started', stream_status TEXT NOT NULL DEFAULT 'not_started',
 scan_cursor TEXT, stream_seq BIGINT NOT NULL DEFAULT 0,
 PRIMARY KEY(network,mode,node_id)
);
CREATE TABLE frame_raw (
 network TEXT NOT NULL,mode TEXT NOT NULL,node_id TEXT NOT NULL,boot_id TEXT NOT NULL,
 method TEXT NOT NULL,entity TEXT NOT NULL,digest TEXT NOT NULL,body JSONB NOT NULL,
 first_seen TIMESTAMPTZ NOT NULL,last_seen TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(network,mode,node_id,boot_id,method,entity,digest)
);
CREATE TABLE frame_admissions (
 network TEXT NOT NULL,mode TEXT NOT NULL,node_id TEXT NOT NULL,boot_id TEXT NOT NULL,
 admission_id BIGINT NOT NULL,tx_hash TEXT NOT NULL,source_at BIGINT NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL,admission JSONB NOT NULL,
 PRIMARY KEY(network,mode,node_id,boot_id,tx_hash),
 UNIQUE(network,mode,node_id,boot_id,admission_id)
);
CREATE TABLE frame_events (
 network TEXT NOT NULL,mode TEXT NOT NULL,node_id TEXT NOT NULL,boot_id TEXT NOT NULL,
 seq BIGINT NOT NULL,tx_hash TEXT NOT NULL,source_at BIGINT NOT NULL,kind TEXT NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL,event JSONB NOT NULL,
 PRIMARY KEY(network,mode,node_id,boot_id,seq)
);
CREATE INDEX frame_events_tx ON frame_events(network,mode,node_id,boot_id,tx_hash,seq);
CREATE TABLE frame_transactions (
 network TEXT NOT NULL,mode TEXT NOT NULL,node_id TEXT NOT NULL,boot_id TEXT NOT NULL,
 tx_hash TEXT NOT NULL,first_observed_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,state JSONB NOT NULL,
 PRIMARY KEY(network,mode,node_id,boot_id,tx_hash)
);
CREATE TABLE frame_receipt_checks (
 network TEXT NOT NULL,mode TEXT NOT NULL,node_id TEXT NOT NULL,boot_id TEXT NOT NULL,
 tx_hash TEXT NOT NULL,checked_at TIMESTAMPTZ NOT NULL,proof JSONB NOT NULL,
 PRIMARY KEY(network,mode,node_id,boot_id,tx_hash)
);
CREATE TABLE frame_incidents (
 network TEXT NOT NULL,mode TEXT NOT NULL,node_id TEXT NOT NULL,boot_id TEXT NOT NULL,
 tx_hash TEXT NOT NULL DEFAULT '',code TEXT NOT NULL,identity TEXT NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL,detail JSONB NOT NULL,
 PRIMARY KEY(network,mode,node_id,boot_id,code,identity)
);
CREATE TABLE frame_submissions (
 attempt_id TEXT PRIMARY KEY, network TEXT NOT NULL,mode TEXT NOT NULL,node_id TEXT NOT NULL,
 expected_hash TEXT NOT NULL,submitted_at TIMESTAMPTZ NOT NULL,
 status TEXT NOT NULL,response JSONB NOT NULL
);
ALTER TABLE frame_raw ADD COLUMN seq BIGSERIAL UNIQUE;
