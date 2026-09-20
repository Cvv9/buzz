-- Tables added after 0033 must participate in the universal community lifecycle
-- fence. Keep this additive: 0036-0038 may already be installed on a database.
SELECT attach_community_write_fence('workflow_admission_mutex'::regclass);
SELECT attach_community_write_fence('workflow_agent_bindings'::regclass);
SELECT attach_community_write_fence('workflow_manual_requests'::regclass);
SELECT attach_community_write_fence('workflow_run_tasks'::regclass);
SELECT attach_community_write_fence('workflow_run_attempts'::regclass);
SELECT attach_community_write_fence('workflow_run_outbox'::regclass);
SELECT attach_community_write_fence('workflow_execution_capabilities'::regclass);
SELECT attach_community_write_fence('workflow_run_credentials'::regclass);
SELECT attach_community_write_fence('workflow_execution_receipts'::regclass);
SELECT attach_community_write_fence('workflow_recovery_receipts'::regclass);
