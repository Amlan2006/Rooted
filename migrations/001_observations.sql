CREATE TABLE observations (
    network TEXT NOT NULL,
    slot NUMERIC(20,0) NOT NULL CHECK (slot >= 0),
    block_root TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL,
    observation JSONB NOT NULL,
    PRIMARY KEY (network, slot, block_root)
);

CREATE TABLE raw_observations (
    network TEXT NOT NULL,
    slot NUMERIC(20,0) NOT NULL,
    block_root TEXT NOT NULL,
    kind TEXT NOT NULL,
    origin TEXT NOT NULL,
    body_sha256 TEXT NOT NULL,
    first_fetched_at TIMESTAMPTZ NOT NULL,
    last_fetched_at TIMESTAMPTZ NOT NULL,
    body JSONB NOT NULL,
    PRIMARY KEY (network, slot, block_root, kind, origin, body_sha256),
    FOREIGN KEY (network, slot, block_root) REFERENCES observations(network, slot, block_root)
);
