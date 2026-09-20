-- Manual execution is a durable control plane; dispatch status is not completion.
-- Deletion must not erase charged allowances or stop evidence through cascades.
ALTER TABLE workflows ADD COLUMN manual_deleted_at TIMESTAMPTZ;
ALTER TABLE workflow_runs
    ADD COLUMN origin TEXT NOT NULL DEFAULT 'event' CHECK (origin IN ('manual','scheduled','event')),
    ADD COLUMN requester BYTEA,
    ADD COLUMN accepted_at TIMESTAMPTZ,
    ADD COLUMN deadline_at TIMESTAMPTZ,
    ADD COLUMN definition_hash BYTEA,
    ADD COLUMN definition_snapshot JSONB,
    ADD COLUMN execution_state TEXT CHECK (execution_state IN ('queued','running','completed','failed','timed_out','stalled')),
    ADD COLUMN dispatch_complete BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN safe_error_code TEXT,
    ADD COLUMN revision BIGINT NOT NULL DEFAULT 0;
-- Unknown legacy dispatches cannot be treated as stopped agent execution.
UPDATE workflow_runs SET execution_state = 'stalled', safe_error_code = 'legacy_execution_unknown'
WHERE status IN ('pending','running','waiting_approval');
ALTER TABLE scheduled_workflow_fires ADD COLUMN outcome TEXT NOT NULL DEFAULT 'started'
    CHECK (outcome IN ('started','skipped_active'));
CREATE INDEX idx_workflow_manual_active ON workflow_runs (community_id, workflow_id, origin)
    WHERE execution_state IN ('queued','running','stalled');
CREATE INDEX idx_workflow_manual_allowance ON workflow_runs (community_id, accepted_at)
    WHERE origin = 'manual';

CREATE TABLE workflow_admission_mutex (
    community_id UUID NOT NULL PRIMARY KEY REFERENCES communities(id) ON DELETE CASCADE
);
CREATE TABLE workflow_agent_bindings (
    community_id UUID NOT NULL REFERENCES communities(id),
    workflow_id UUID NOT NULL,
    definition_hash BYTEA NOT NULL,
    step_id TEXT NOT NULL,
    agent_pubkey BYTEA NOT NULL CHECK (length(agent_pubkey) = 32),
    destination_channel UUID NOT NULL,
    provenance TEXT NOT NULL CHECK (provenance IN ('explicit_owner_definition','verified_task_evidence')),
    PRIMARY KEY (community_id, workflow_id, step_id, agent_pubkey),
    FOREIGN KEY (community_id, workflow_id) REFERENCES workflows(community_id,id) ON DELETE CASCADE,
    FOREIGN KEY (community_id, destination_channel) REFERENCES channels(community_id,id),
    FOREIGN KEY (community_id, agent_pubkey) REFERENCES users(community_id,pubkey)
);
CREATE TABLE workflow_manual_requests (
    community_id UUID NOT NULL REFERENCES communities(id),
    request_event_id BYTEA NOT NULL CHECK (length(request_event_id) = 32),
    workflow_id UUID NOT NULL,
    requester BYTEA NOT NULL CHECK (length(requester) = 32),
    decision JSONB NOT NULL,
    run_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (community_id, request_event_id),
    FOREIGN KEY (community_id, workflow_id) REFERENCES workflows(community_id,id) ON DELETE CASCADE,
    FOREIGN KEY (community_id, run_id) REFERENCES workflow_runs(community_id,id) ON DELETE CASCADE
);
CREATE TABLE workflow_run_tasks (
    community_id UUID NOT NULL REFERENCES communities(id),
    run_id UUID NOT NULL,
    task_id UUID NOT NULL,
    step_id TEXT NOT NULL,
    agent_pubkey BYTEA NOT NULL CHECK (length(agent_pubkey) = 32),
    channel_id UUID NOT NULL,
    task_event_id BYTEA,
    state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','completed','failed','timed_out','stalled')),
    result_event_id BYTEA,
    runner_instance UUID,
    attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    PRIMARY KEY (community_id, run_id, task_id),
    UNIQUE (community_id, run_id, step_id, agent_pubkey),
    FOREIGN KEY (community_id, run_id) REFERENCES workflow_runs(community_id,id) ON DELETE CASCADE,
    FOREIGN KEY (community_id, channel_id) REFERENCES channels(community_id,id),
    FOREIGN KEY (community_id, agent_pubkey) REFERENCES users(community_id,pubkey)
);
CREATE INDEX idx_workflow_tasks_active_target ON workflow_run_tasks(community_id,agent_pubkey,run_id);
CREATE TABLE workflow_run_attempts (
    community_id UUID NOT NULL REFERENCES communities(id),
    run_id UUID NOT NULL,
    ordinal INT NOT NULL CHECK (ordinal > 0),
    task_id UUID NOT NULL,
    grant_id UUID NOT NULL,
    instance_id UUID NOT NULL,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deadline_at TIMESTAMPTZ NOT NULL,
    stopped_at TIMESTAMPTZ,
    outcome TEXT,
    PRIMARY KEY (community_id, run_id, ordinal),
    UNIQUE (community_id, grant_id),
    FOREIGN KEY (community_id, run_id, task_id) REFERENCES workflow_run_tasks(community_id,run_id,task_id) ON DELETE CASCADE
);
CREATE TABLE workflow_run_outbox (
    community_id UUID NOT NULL REFERENCES communities(id),
    id UUID NOT NULL,
    run_id UUID NOT NULL,
    event_id BYTEA NOT NULL CHECK (length(event_id) = 32),
    signed_event JSONB NOT NULL,
    delivered_at TIMESTAMPTZ,
    PRIMARY KEY (community_id,id),
    UNIQUE (community_id,event_id),
    FOREIGN KEY (community_id,run_id) REFERENCES workflow_runs(community_id,id) ON DELETE CASCADE
);
CREATE TABLE workflow_execution_capabilities (
    community_id UUID NOT NULL REFERENCES communities(id),
    agent_pubkey BYTEA NOT NULL CHECK (length(agent_pubkey) = 32),
    instance_id UUID NOT NULL,
    protocol_version INT NOT NULL CHECK (protocol_version = 1),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (community_id,agent_pubkey),
    FOREIGN KEY (community_id,agent_pubkey) REFERENCES users(community_id,pubkey) ON DELETE CASCADE
);
CREATE TABLE workflow_run_credentials (
    community_id UUID NOT NULL REFERENCES communities(id),
    ephemeral_pubkey BYTEA NOT NULL CHECK (length(ephemeral_pubkey) = 32),
    run_id UUID NOT NULL,
    agent_pubkey BYTEA NOT NULL CHECK (length(agent_pubkey) = 32),
    attempt_ordinal INT NOT NULL CHECK (attempt_ordinal > 0),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    PRIMARY KEY (community_id,ephemeral_pubkey),
    FOREIGN KEY (community_id,run_id,attempt_ordinal) REFERENCES workflow_run_attempts(community_id,run_id,ordinal) ON DELETE CASCADE,
    FOREIGN KEY (community_id,agent_pubkey) REFERENCES users(community_id,pubkey)
);
