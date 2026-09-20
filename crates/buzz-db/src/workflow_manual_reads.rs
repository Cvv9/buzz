//! Authorized read projections for manually runnable scheduled workflows.
use buzz_core::CommunityId;
use sqlx::Row;
use uuid::Uuid;

use crate::{error::Result, workflow::WorkflowRecord, Db};

impl Db {
    /// Page scheduled definitions by immutable target, excluding every hidden
    /// destination before pagination. Display names never establish association.
    pub async fn agent_scheduled_workflows_page(
        &self,
        community: CommunityId,
        requester: &[u8],
        agent: &[u8],
        after: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<WorkflowRecord>> {
        let rows = sqlx::query(
            "SELECT w.id,w.community_id,w.name,w.owner_pubkey,w.channel_id,w.definition,w.definition_hash,w.status::text AS status,w.enabled,w.created_at,w.updated_at
             FROM workflows w
             WHERE w.community_id=$1 AND w.manual_deleted_at IS NULL AND ($4::uuid IS NULL OR w.id>$4)
             AND w.definition->'trigger'->>'on'='schedule'
             AND EXISTS(SELECT 1 FROM relay_members m WHERE m.community_id=w.community_id AND m.pubkey=encode($2::bytea,'hex') AND m.role='owner')
             AND EXISTS(SELECT 1 FROM users u WHERE u.community_id=w.community_id AND u.pubkey=$3 AND u.agent_owner_pubkey=$2 AND u.deactivated_at IS NULL)
             AND EXISTS(SELECT 1 FROM channels c WHERE c.community_id=w.community_id AND c.id=w.channel_id AND c.deleted_at IS NULL AND
                 (c.visibility='open' OR EXISTS(SELECT 1 FROM channel_members m WHERE m.community_id=c.community_id AND m.channel_id=c.id AND m.pubkey=$2 AND m.removed_at IS NULL)))
             AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w.definition->'steps') s WHERE s->>'channel' IS NOT NULL AND s->>'channel' IS DISTINCT FROM w.channel_id::text)
             AND (EXISTS(SELECT 1 FROM workflow_agent_bindings b WHERE b.community_id=w.community_id AND b.workflow_id=w.id AND b.definition_hash=w.definition_hash AND b.agent_pubkey=$3)
                 OR EXISTS(SELECT 1 FROM jsonb_array_elements(w.definition->'steps') s WHERE s->'agent_targets' @> jsonb_build_array(encode($3::bytea,'hex'))))
             ORDER BY w.id LIMIT $5",
        )
        .bind(community.as_uuid()).bind(requester).bind(agent).bind(after).bind(limit.clamp(1,101))
        .fetch_all(&self.pool).await?;
        rows.into_iter()
            .map(|row| {
                Ok(WorkflowRecord {
                    id: row.try_get("id")?,
                    community_id: community,
                    name: row.try_get("name")?,
                    owner_pubkey: row.try_get("owner_pubkey")?,
                    channel_id: row.try_get("channel_id")?,
                    definition: row.try_get("definition")?,
                    definition_hash: row.try_get("definition_hash")?,
                    status: row.try_get::<String, _>("status")?.parse()?,
                    enabled: row.try_get("enabled")?,
                    created_at: row.try_get("created_at")?,
                    updated_at: row.try_get("updated_at")?,
                })
            })
            .collect()
    }

    /// Verified result references for this run; never raw task prompts or labels.
    pub async fn workflow_run_results(
        &self,
        community: CommunityId,
        run: Uuid,
    ) -> Result<Vec<serde_json::Value>> {
        let rows = sqlx::query("SELECT task_id,channel_id,result_event_id FROM workflow_run_tasks WHERE community_id=$1 AND run_id=$2 AND result_event_id IS NOT NULL AND channel_id=(SELECT w.channel_id FROM workflows w JOIN workflow_runs r ON r.community_id=w.community_id AND r.workflow_id=w.id WHERE r.community_id=$1 AND r.id=$2) ORDER BY task_id")
            .bind(community.as_uuid()).bind(run).fetch_all(&self.pool).await?;
        rows.into_iter().map(|row| {
            let channel: Uuid = row.try_get("channel_id")?;
            let event = hex::encode(row.try_get::<Vec<u8>,_>("result_event_id")?);
            Ok(serde_json::json!({"task_id":row.try_get::<Uuid,_>("task_id")?,"channel_id":channel,"event_id":event,"url":format!("buzz://message?channel={channel}&id={event}")}))
        }).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::channel::{ChannelType, ChannelVisibility};
    use nostr::Keys;

    #[tokio::test]
    #[ignore = "requires isolated Postgres"]
    async fn workflow_summary_discovery_is_stable_private_and_paginated() {
        let url = std::env::var("DATABASE_URL").expect("isolated DATABASE_URL required");
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(4)
            .connect(&url)
            .await
            .unwrap();
        crate::migration::run_migrations(&pool).await.unwrap();
        let db = Db::from_pool(pool);
        let owner = Keys::generate().public_key().to_bytes();
        let agent = Keys::generate().public_key().to_bytes();
        let outsider = Keys::generate().public_key().to_bytes();
        let community = match db
            .create_community_with_owner(
                &format!("summary-{}.test", Uuid::new_v4()),
                &hex::encode(owner),
            )
            .await
            .unwrap()
        {
            crate::CreateCommunityWithOwnerResult::Created(record) => record.id,
            other => panic!("unexpected {other:?}"),
        };
        for key in [&owner, &agent, &outsider] {
            db.ensure_user(community, key).await.unwrap();
        }
        db.set_agent_owner(community, &agent, &owner).await.unwrap();
        let visible = db
            .create_channel(
                community,
                "visible",
                ChannelType::Stream,
                ChannelVisibility::Private,
                None,
                &owner,
                None,
            )
            .await
            .unwrap();
        let hidden = db
            .create_channel(
                community,
                "hidden",
                ChannelType::Stream,
                ChannelVisibility::Private,
                None,
                &outsider,
                None,
            )
            .await
            .unwrap();
        let definition = serde_json::json!({"name":"Daily","trigger":{"on":"schedule","cron":"0 9 * * *"},"steps":[{"id":"brief","action":"send_message","text":"@old-name","channel":null,"agent_targets":[hex::encode(agent)]}]});
        let mut expected = Vec::new();
        for channel in [visible.id, visible.id, hidden.id] {
            let id = Uuid::new_v4();
            db.upsert_workflow(
                community,
                id,
                Some(channel),
                &owner,
                "Daily",
                &definition.to_string(),
                &[1; 32],
            )
            .await
            .unwrap();
            if channel == visible.id {
                expected.push(id);
            }
        }
        expected.sort();
        // A display-name mention without an immutable binding does not associate.
        let mut legacy = definition.clone();
        legacy["steps"][0]
            .as_object_mut()
            .unwrap()
            .remove("agent_targets");
        db.upsert_workflow(
            community,
            Uuid::new_v4(),
            Some(visible.id),
            &owner,
            "Legacy",
            &legacy.to_string(),
            &[2; 32],
        )
        .await
        .unwrap();
        // A visible workflow cannot leak any hidden destination through its row.
        let mut cross = definition.clone();
        cross["steps"][0]["channel"] = hidden.id.to_string().into();
        db.upsert_workflow(
            community,
            Uuid::new_v4(),
            Some(visible.id),
            &owner,
            "Cross",
            &cross.to_string(),
            &[3; 32],
        )
        .await
        .unwrap();
        let first = db
            .agent_scheduled_workflows_page(community, &owner, &agent, None, 1)
            .await
            .unwrap();
        assert_eq!(
            first.iter().map(|r| r.id).collect::<Vec<_>>(),
            vec![expected[0]]
        );
        let second = db
            .agent_scheduled_workflows_page(community, &owner, &agent, Some(first[0].id), 1)
            .await
            .unwrap();
        assert_eq!(
            second.iter().map(|r| r.id).collect::<Vec<_>>(),
            vec![expected[1]]
        );
        assert!(db
            .agent_scheduled_workflows_page(community, &owner, &agent, Some(second[0].id), 1)
            .await
            .unwrap()
            .is_empty());
        assert!(db
            .agent_scheduled_workflows_page(community, &outsider, &agent, None, 100)
            .await
            .unwrap()
            .is_empty());
        assert!(db
            .agent_scheduled_workflows_page(
                CommunityId::from_uuid(Uuid::new_v4()),
                &owner,
                &agent,
                None,
                100
            )
            .await
            .unwrap()
            .is_empty());
        sqlx::query("UPDATE users SET display_name='Renamed' WHERE community_id=$1 AND pubkey=$2")
            .bind(community.as_uuid())
            .bind(agent.as_slice())
            .execute(&db.pool)
            .await
            .unwrap();
        assert_eq!(
            db.agent_scheduled_workflows_page(community, &owner, &agent, None, 100)
                .await
                .unwrap()
                .len(),
            2
        );
    }
}
