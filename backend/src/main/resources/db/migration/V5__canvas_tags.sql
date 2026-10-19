CREATE TABLE canvas_tags (
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK (char_length(tag) BETWEEN 1 AND 40),
  normalized_tag TEXT NOT NULL CHECK (char_length(normalized_tag) BETWEEN 1 AND 40),
  PRIMARY KEY (board_id, normalized_tag)
);

CREATE INDEX canvas_tags_normalized_tag ON canvas_tags(normalized_tag, board_id);
