ALTER TABLE boards ADD COLUMN epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE boards ADD COLUMN revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE boards ADD COLUMN invite_key_hash CHAR(64);
ALTER TABLE boards ADD COLUMN owner_subject VARCHAR(512);
ALTER TABLE boards ADD CONSTRAINT boards_mode CHECK (mode IN ('standard', 'poker'));
ALTER TABLE boards ADD CONSTRAINT boards_round_mode CHECK ((mode = 'poker') = (current_round_id IS NOT NULL));
ALTER TABLE boards ADD CONSTRAINT boards_current_round FOREIGN KEY (current_round_id) REFERENCES rounds(id);
ALTER TABLE participants ADD COLUMN subject VARCHAR(512);
ALTER TABLE participants ADD COLUMN expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 day');
ALTER TABLE participants ADD COLUMN revoked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE participants ADD CONSTRAINT participants_role CHECK (role IN ('host', 'guest'));
ALTER TABLE rounds ADD CONSTRAINT rounds_status CHECK (status IN ('editing', 'revealed', 'cancelled'));
ALTER TABLE round_participants ADD COLUMN draft_revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE elements ADD COLUMN stored_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN stored_bytes BIGINT NOT NULL DEFAULT 0;
UPDATE elements SET stored_bytes=octet_length(body::text);
UPDATE assets SET stored_bytes=octet_length(body::text);
CREATE INDEX elements_round ON elements(round_id);
CREATE INDEX assets_round ON assets(round_id);
CREATE INDEX participants_subject ON participants(board_id, subject) WHERE subject IS NOT NULL;

-- Receipts make retries safe after a committed command loses its acknowledgement.
CREATE TABLE command_receipts (
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  command_id UUID NOT NULL,
  revision BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (participant_id, command_id)
);
CREATE INDEX command_receipts_created ON command_receipts(created_at);
CREATE INDEX command_receipts_participant_created ON command_receipts(participant_id,created_at);
