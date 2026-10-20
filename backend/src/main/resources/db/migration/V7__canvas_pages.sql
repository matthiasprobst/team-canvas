CREATE TABLE canvas_pages (
  id UUID PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  created_by UUID REFERENCES participants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (board_id, position),
  UNIQUE (board_id, id)
);

ALTER TABLE boards ADD COLUMN current_page_id UUID;

INSERT INTO canvas_pages(id, board_id, position)
SELECT gen_random_uuid(), id, 0 FROM boards;

UPDATE boards b SET current_page_id=p.id
FROM canvas_pages p WHERE p.board_id=b.id AND p.position=0;

ALTER TABLE boards ADD CONSTRAINT boards_current_page
  FOREIGN KEY (id, current_page_id) REFERENCES canvas_pages(board_id, id);

ALTER TABLE elements ADD COLUMN page_id UUID;
ALTER TABLE assets ADD COLUMN page_id UUID;
ALTER TABLE elements ADD COLUMN poker_created BOOLEAN NOT NULL DEFAULT false;

UPDATE elements e SET page_id=b.current_page_id FROM boards b WHERE b.id=e.board_id;
UPDATE assets a SET page_id=b.current_page_id FROM boards b WHERE b.id=a.board_id;

ALTER TABLE elements ALTER COLUMN page_id SET NOT NULL;
ALTER TABLE assets ALTER COLUMN page_id SET NOT NULL;
ALTER TABLE elements ADD CONSTRAINT elements_page FOREIGN KEY (board_id, page_id)
  REFERENCES canvas_pages(board_id, id) ON DELETE CASCADE;
ALTER TABLE assets ADD CONSTRAINT assets_page FOREIGN KEY (board_id, page_id)
  REFERENCES canvas_pages(board_id, id) ON DELETE CASCADE;
CREATE INDEX elements_page_visibility ON elements(board_id, page_id, scope, author_id);
CREATE INDEX assets_page_visibility ON assets(board_id, page_id, scope, author_id);

CREATE FUNCTION create_initial_canvas_page() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE page UUID := gen_random_uuid();
BEGIN
  INSERT INTO canvas_pages(id, board_id, position) VALUES(page, NEW.id, 0);
  UPDATE boards SET current_page_id=page WHERE id=NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER boards_initial_page AFTER INSERT ON boards
FOR EACH ROW EXECUTE FUNCTION create_initial_canvas_page();
