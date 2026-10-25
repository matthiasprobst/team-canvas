ALTER TABLE app_users ADD COLUMN username VARCHAR(120);

CREATE TABLE canvas_access_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  target_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX canvas_access_events_board ON canvas_access_events(board_id,id DESC);
