-- Fold kind:40003 message edits into full-text search.
--
-- `events.search_tsv` is a GENERATED ALWAYS column derived from `content`, and
-- `content` is the immutable signed event payload — it cannot be rewritten when
-- a later kind:40003 edit changes the readable body. Without this migration a
-- search matches (and surfaces) a message's PRE-edit text forever, because the
-- target row's tsvector never reflects the edit.
--
-- Fix: add a nullable `edited_content` override that the relay writes on an
-- accepted edit (last-writer-wins by `edited_at`, mirroring the client's
-- newest-edit-wins folding), and rebuild `search_tsv` to index
-- `COALESCE(edited_content, content)`. Unedited rows keep `edited_content` NULL
-- and index `content` exactly as before, so search over never-edited messages
-- is byte-for-byte unchanged.

-- Editable search source + last-writer-wins fence (edit `created_at`, seconds).
ALTER TABLE events ADD COLUMN edited_content TEXT;
ALTER TABLE events ADD COLUMN edited_at BIGINT;

-- Rebuild the generated tsvector to read from the override. PostgreSQL cannot
-- alter a generated expression in place, and migrations 0005/0008/0014 mean the
-- live expression varies (fresh-install allowlist vs brownfield/operator
-- denylist). Capture whatever is deployed and swap only the `content` source for
-- `COALESCE(edited_content, content)`, preserving every kind-exclusion rule. The
-- `\y` word boundary matches the `content` column reference(s) without touching
-- the `content` inside the replacement's own `edited_content`.
DO $$
DECLARE
    existing_expression TEXT;
BEGIN
    SELECT pg_get_expr(d.adbin, d.adrelid)
      INTO existing_expression
      FROM pg_attrdef d
      JOIN pg_attribute a
        ON a.attrelid = d.adrelid
       AND a.attnum = d.adnum
     WHERE d.adrelid = 'events'::regclass
       AND a.attname = 'search_tsv';

    IF existing_expression IS NULL THEN
        RAISE EXCEPTION 'events.search_tsv generated expression not found';
    END IF;

    ALTER TABLE events DROP COLUMN search_tsv;
    EXECUTE format(
        'ALTER TABLE events ADD COLUMN search_tsv TSVECTOR GENERATED ALWAYS AS (%s) STORED',
        regexp_replace(
            existing_expression,
            '\ycontent\y',
            'COALESCE(edited_content, content)',
            'g'
        )
    );
    CREATE INDEX idx_events_search_tsv ON events USING GIN (search_tsv);
END $$;
