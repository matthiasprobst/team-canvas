CREATE TABLE boards (
  id UUID PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  host_key_hash CHAR(64) NOT NULL,
  mode VARCHAR(16) NOT NULL DEFAULT 'standard',
  current_round_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE participants (
  id UUID PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name VARCHAR(48) NOT NULL,
  role VARCHAR(16) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX participants_board ON participants(board_id);
CREATE TABLE rounds (
  id UUID PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revealed_at TIMESTAMPTZ
);
CREATE TABLE round_participants (
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  done BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY(round_id, participant_id)
);
CREATE TABLE elements (
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  id VARCHAR(128) NOT NULL,
  body JSONB NOT NULL,
  scope VARCHAR(16) NOT NULL CHECK (scope IN ('public', 'private')),
  author_id UUID NOT NULL REFERENCES participants(id),
  round_id UUID REFERENCES rounds(id),
  PRIMARY KEY (board_id, id)
);
CREATE INDEX elements_visibility ON elements(board_id, scope, author_id);
CREATE TABLE assets (
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  id VARCHAR(128) NOT NULL,
  body JSONB NOT NULL,
  scope VARCHAR(16) NOT NULL CHECK (scope IN ('public', 'private')),
  author_id UUID NOT NULL REFERENCES participants(id),
  round_id UUID REFERENCES rounds(id),
  PRIMARY KEY (board_id, id)
);
CREATE INDEX assets_visibility ON assets(board_id, scope, author_id);
