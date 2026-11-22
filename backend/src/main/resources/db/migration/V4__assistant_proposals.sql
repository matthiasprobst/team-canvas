-- Private proposals are addressed only by a round capability hash, never by an account.
CREATE TABLE assistant_proposals (
  id UUID PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  page_id UUID NOT NULL,
  owner_key CHAR(64) NOT NULL,
  epoch BIGINT NOT NULL,
  round_id UUID,
  body JSONB NOT NULL,
  targets JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(board_id,page_id) REFERENCES canvas_pages(board_id,id) ON DELETE CASCADE,
  FOREIGN KEY(board_id,round_id) REFERENCES rounds(board_id,id) ON DELETE CASCADE
);
CREATE INDEX assistant_proposals_pending ON assistant_proposals(board_id,owner_key,created_at) WHERE status='pending';
