CREATE TABLE pw_events (
    seq BIGSERIAL PRIMARY KEY,
    network TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('live','replay','synthetic')),
    source_id TEXT NOT NULL, event_id TEXT NOT NULL, slot NUMERIC(20,0) NOT NULL,
    block_root TEXT NOT NULL, kind TEXT NOT NULL, observed_at TIMESTAMPTZ NOT NULL,
    event JSONB NOT NULL,
    UNIQUE(network,mode,source_id,event_id)
);
CREATE INDEX pw_events_root ON pw_events(network,mode,source_id,slot,block_root,seq);
CREATE TABLE pw_states (
    network TEXT NOT NULL, mode TEXT NOT NULL, source_id TEXT NOT NULL,
    slot NUMERIC(20,0) NOT NULL, block_root TEXT NOT NULL,
    builder_index TEXT, canonical BOOLEAN, updated_at TIMESTAMPTZ NOT NULL,
    state JSONB NOT NULL,
    PRIMARY KEY(network,mode,source_id,slot,block_root)
);
CREATE TABLE pw_sessions (
    network TEXT NOT NULL, mode TEXT NOT NULL, source_id TEXT NOT NULL, session_id TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL, last_activity TIMESTAMPTZ NOT NULL, closed BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY(network,mode,source_id,session_id)
);
CREATE TABLE pw_outcomes (
    network TEXT NOT NULL, mode TEXT NOT NULL, source_id TEXT NOT NULL,
    slot NUMERIC(20,0) NOT NULL, block_root TEXT NOT NULL, outcome TEXT NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(network,mode,source_id,slot,block_root,outcome)
);
CREATE TABLE pw_latency_samples (
    network TEXT NOT NULL, mode TEXT NOT NULL, source_id TEXT NOT NULL,
    slot NUMERIC(20,0) NOT NULL, block_root TEXT NOT NULL,
    latency_ms BIGINT NOT NULL CHECK(latency_ms>=0),
    PRIMARY KEY(network,mode,source_id,slot,block_root)
);
CREATE TABLE pw_alerts (
    network TEXT NOT NULL, mode TEXT NOT NULL, source_id TEXT NOT NULL,
    slot NUMERIC(20,0) NOT NULL, block_root TEXT NOT NULL,
    code TEXT NOT NULL, first_detected_at TIMESTAMPTZ NOT NULL,
    active BOOLEAN NOT NULL, resolved_at TIMESTAMPTZ,
    PRIMARY KEY(network,mode,source_id,slot,block_root,code)
);
CREATE TABLE pw_progress (
    network TEXT NOT NULL, source_id TEXT NOT NULL,
    last_slot NUMERIC(20,0), last_success TIMESTAMPTZ,
    stream_status TEXT NOT NULL DEFAULT 'not_started',
    poll_status TEXT NOT NULL DEFAULT 'not_started',
    PRIMARY KEY(network,source_id)
);
