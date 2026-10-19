ALTER TABLE boards
  ADD COLUMN template_visibility VARCHAR(7)
  CHECK (template_visibility IS NULL OR template_visibility IN ('private', 'public'));

CREATE INDEX boards_template_visibility
  ON boards(template_visibility, created_at DESC)
  WHERE template_visibility IS NOT NULL;
