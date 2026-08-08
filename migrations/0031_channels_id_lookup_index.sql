-- Cover tenant-independent channel-id lookups without changing the immutable
-- migration 27 already deployed by the VarVik relay. Migration 27 originally
-- removed legacy workflow-owner mentions; an upstream lineage later reused
-- that number for this index. Keep the production checksum stable and apply
-- the additive index at the next unused version instead.
--
-- `channels` is keyed by (community_id, id), while these ownership lookups
-- intentionally constrain only `id`. INCLUDE makes the index covering for
-- the selected community_id, and the partial predicate matches both queries.
-- The index is deliberately non-unique because a channel id can occur in more
-- than one community.
CREATE INDEX IF NOT EXISTS idx_channels_id_live
    ON channels (id) INCLUDE (community_id)
    WHERE deleted_at IS NULL;
