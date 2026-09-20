-- Controller attestations contain public identifiers/hashes, never provider logs or keys.
CREATE TABLE workflow_recovery_receipts (
    community_id UUID NOT NULL REFERENCES communities(id),
    event_id BYTEA NOT NULL CHECK (length(event_id)=32),
    controller_pubkey BYTEA NOT NULL CHECK (length(controller_pubkey)=32),
    target_agent BYTEA NOT NULL CHECK (length(target_agent)=32),
    evidence_id BYTEA NOT NULL CHECK (length(evidence_id)=32),
    container_id TEXT NOT NULL CHECK (container_id ~ '^[0-9a-f]{64}$'),
    control JSONB NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (community_id,event_id),
    UNIQUE (community_id,evidence_id)
);
