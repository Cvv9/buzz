-- Durable control receipts and exact signed delivery acknowledgement.
ALTER TABLE workflow_run_attempts
    ADD COLUMN started_at TIMESTAMPTZ,
    ADD COLUMN grant_decision JSONB;
ALTER TABLE workflow_run_outbox ADD COLUMN acknowledged_at TIMESTAMPTZ;
CREATE TABLE workflow_execution_receipts (
    community_id UUID NOT NULL REFERENCES communities(id),
    event_id BYTEA NOT NULL CHECK (length(event_id)=32),
    agent_pubkey BYTEA NOT NULL CHECK (length(agent_pubkey)=32),
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (community_id,event_id)
);
-- A credential must never become an ordinary identity in another community.
CREATE UNIQUE INDEX workflow_credentials_global_identity ON workflow_run_credentials(ephemeral_pubkey);

ALTER TABLE workflow_execution_capabilities ADD COLUMN max_turn_duration_secs BIGINT NOT NULL DEFAULT 7200 CHECK (max_turn_duration_secs BETWEEN 1 AND 604800);
