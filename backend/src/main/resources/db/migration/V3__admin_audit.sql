-- Account references are erased on offboarding, including historical events.
-- Never store names, issuer/subject, blocking fingerprints, or replacement-owner links here.
CREATE TABLE admin_audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  target_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  board_id UUID REFERENCES boards(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('deactivate','reactivate','anonymize','delete','reassign','invalid_action')),
  result TEXT NOT NULL CHECK(result IN ('succeeded','access_revoked','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_events_created ON admin_audit_events(created_at,id);
