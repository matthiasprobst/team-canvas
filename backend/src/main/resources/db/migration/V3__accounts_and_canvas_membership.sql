CREATE TABLE app_users (
  id UUID PRIMARY KEY,
  issuer VARCHAR(2048) NOT NULL,
  subject VARCHAR(512) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);
CREATE TABLE login_sessions (
  user_id UUID NOT NULL REFERENCES app_users(id),
  sid VARCHAR(512) NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sid)
);
ALTER TABLE boards ADD COLUMN owner_user_id UUID REFERENCES app_users(id);
ALTER TABLE boards ALTER COLUMN host_key_hash DROP NOT NULL;
CREATE INDEX boards_owner ON boards(owner_user_id);
ALTER TABLE participants ADD COLUMN user_id UUID REFERENCES app_users(id);
ALTER TABLE participants ADD COLUMN last_opened_at TIMESTAMPTZ;
ALTER TABLE participants ALTER COLUMN token_hash DROP NOT NULL;
CREATE UNIQUE INDEX participants_user_board ON participants(user_id, board_id) WHERE user_id IS NOT NULL;
CREATE INDEX participants_dashboard ON participants(user_id, last_opened_at DESC, board_id) WHERE revoked=false;
CREATE TABLE board_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  sid VARCHAR(512) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 day'),
  revoked BOOLEAN NOT NULL DEFAULT false,
  FOREIGN KEY (user_id, sid) REFERENCES login_sessions(user_id, sid)
);
CREATE INDEX board_sessions_login ON board_sessions(user_id, sid);
CREATE INDEX board_sessions_participant ON board_sessions(participant_id);
CREATE INDEX board_sessions_expiry ON board_sessions(expires_at);
CREATE TABLE board_invitations (
  id UUID PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES app_users(id),
  secret_hash CHAR(64) NOT NULL UNIQUE,
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX board_invitations_board ON board_invitations(board_id);
