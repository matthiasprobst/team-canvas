-- Initial-development schema. Reset disposable development data explicitly when changing it.
CREATE TABLE app_users (
  id UUID PRIMARY KEY,
  issuer TEXT,
  subject TEXT,
  display_name VARCHAR(120) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','deactivated','placeholder')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(issuer,subject),
  CHECK ((status='placeholder' AND issuer IS NULL AND subject IS NULL) OR
         (status<>'placeholder' AND issuer IS NOT NULL AND subject IS NOT NULL))
);
CREATE TABLE blocked_identities (fingerprint CHAR(64) PRIMARY KEY, key_id CHAR(16) NOT NULL, action TEXT NOT NULL CHECK(action IN ('anonymize','delete')));
CREATE SEQUENCE deleted_user_number;
CREATE TABLE login_sessions (
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  sid VARCHAR(512) NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,sid)
);
CREATE TABLE boards (
  id UUID PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES app_users(id),
  mode TEXT NOT NULL DEFAULT 'standard' CHECK(mode IN ('standard','poker')),
  current_round_id UUID,
  current_page_id UUID,
  epoch BIGINT NOT NULL DEFAULT 0,
  revision BIGINT NOT NULL DEFAULT 0,
  template_visibility TEXT CHECK(template_visibility IN ('private','public')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((mode='poker')=(current_round_id IS NOT NULL))
);
CREATE INDEX boards_owner ON boards(owner_user_id);
CREATE TABLE participants (
  id UUID PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name VARCHAR(48) NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('host','guest')),
  revoked BOOLEAN NOT NULL DEFAULT false,
  last_opened_at TIMESTAMPTZ,
  UNIQUE(user_id,board_id)
);
CREATE INDEX participants_board ON participants(board_id);
CREATE INDEX participants_dashboard ON participants(user_id,last_opened_at DESC,board_id) WHERE NOT revoked;
CREATE TABLE board_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  sid VARCHAR(512) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '1 day',
  revoked BOOLEAN NOT NULL DEFAULT false,
  FOREIGN KEY(user_id,sid) REFERENCES login_sessions(user_id,sid) ON DELETE CASCADE
);
CREATE INDEX board_sessions_login ON board_sessions(user_id,sid);
CREATE INDEX board_sessions_participant ON board_sessions(participant_id);
CREATE INDEX board_sessions_expiry ON board_sessions(expires_at);
CREATE TABLE board_invitations (
  id UUID PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  creator_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  secret_hash CHAR(64) NOT NULL UNIQUE,
  revoked BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '7 days'
);
CREATE INDEX board_invitations_board ON board_invitations(board_id);
CREATE TABLE canvas_pages (
  id UUID PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(position>=0),
  UNIQUE(board_id,position),
  UNIQUE(board_id,id)
);
ALTER TABLE boards ADD CONSTRAINT boards_current_page FOREIGN KEY(id,current_page_id)
  REFERENCES canvas_pages(board_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION create_initial_canvas_page() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE page UUID := gen_random_uuid();
BEGIN
  INSERT INTO canvas_pages(id,board_id,position) VALUES(page,NEW.id,0);
  UPDATE boards SET current_page_id=page WHERE id=NEW.id;
  RETURN NEW;
END; $$;
CREATE TRIGGER boards_initial_page AFTER INSERT ON boards FOR EACH ROW EXECUTE FUNCTION create_initial_canvas_page();
CREATE TABLE rounds (
  id UUID PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  UNIQUE(board_id,id)
);
ALTER TABLE boards ADD CONSTRAINT boards_current_round FOREIGN KEY(id,current_round_id)
  REFERENCES rounds(board_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE private_drafts (
  board_id UUID NOT NULL,
  round_id UUID NOT NULL,
  draft_hash CHAR(64) NOT NULL,
  PRIMARY KEY(board_id,round_id,draft_hash),
  FOREIGN KEY(board_id,round_id) REFERENCES rounds(board_id,id) ON DELETE CASCADE
);
CREATE TABLE elements (
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  id VARCHAR(128) NOT NULL,
  page_id UUID NOT NULL,
  body JSONB NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('public','private')),
  draft_hash CHAR(64),
  round_id UUID,
  stored_bytes BIGINT NOT NULL CHECK(stored_bytes>=0),
  poker_created BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY(board_id,id),
  FOREIGN KEY(board_id,page_id) REFERENCES canvas_pages(board_id,id) ON DELETE CASCADE,
  FOREIGN KEY(board_id,round_id,draft_hash) REFERENCES private_drafts(board_id,round_id,draft_hash) ON DELETE CASCADE,
  CHECK ((scope='public' AND draft_hash IS NULL AND round_id IS NULL) OR
         (scope='private' AND draft_hash IS NOT NULL AND round_id IS NOT NULL))
);
CREATE INDEX elements_visibility ON elements(board_id,page_id,scope,draft_hash);
CREATE TABLE assets (
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  id VARCHAR(128) NOT NULL,
  page_id UUID NOT NULL,
  body JSONB NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('public','private')),
  draft_hash CHAR(64),
  round_id UUID,
  stored_bytes BIGINT NOT NULL CHECK(stored_bytes>=0),
  PRIMARY KEY(board_id,id),
  FOREIGN KEY(board_id,page_id) REFERENCES canvas_pages(board_id,id) ON DELETE CASCADE,
  FOREIGN KEY(board_id,round_id,draft_hash) REFERENCES private_drafts(board_id,round_id,draft_hash) ON DELETE CASCADE,
  CHECK ((scope='public' AND draft_hash IS NULL AND round_id IS NULL) OR
         (scope='private' AND draft_hash IS NOT NULL AND round_id IS NOT NULL))
);
CREATE INDEX assets_visibility ON assets(board_id,page_id,scope,draft_hash);
CREATE TABLE command_receipts (
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  receipt_scope TEXT NOT NULL,
  command_id UUID NOT NULL,
  revision BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(board_id,receipt_scope,command_id)
);
CREATE INDEX command_receipts_created ON command_receipts(created_at);
CREATE TABLE canvas_tags (
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK(char_length(tag) BETWEEN 1 AND 40),
  normalized_tag TEXT NOT NULL CHECK(char_length(normalized_tag) BETWEEN 1 AND 40),
  PRIMARY KEY(board_id,normalized_tag)
);
CREATE INDEX canvas_tags_normalized ON canvas_tags(normalized_tag,board_id);
