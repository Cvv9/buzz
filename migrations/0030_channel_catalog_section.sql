-- A shared catalog section for channel navigation. This is deliberately channel
-- metadata (and is emitted in the relay-signed kind:39000 discovery event), not
-- a per-client preference, so web and desktop render the same organization.
ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS catalog_section VARCHAR(80);
