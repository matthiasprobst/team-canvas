ALTER TABLE app_users ADD COLUMN avatar_data BYTEA;
ALTER TABLE app_users ADD COLUMN avatar_mime_type VARCHAR(32);
ALTER TABLE app_users ADD COLUMN avatar_version BIGINT NOT NULL DEFAULT 0;

CREATE TABLE canvas_avatars (
  id UUID PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id),
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX canvas_avatars_board ON canvas_avatars(board_id, created_at, id);
