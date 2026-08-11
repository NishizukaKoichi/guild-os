DROP INDEX chronicle_search_idx;

ALTER TABLE chronicle_events DROP COLUMN search_document;

ALTER TABLE chronicle_events
  ADD COLUMN search_document tsvector GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      translate(action, '._-', '   ') || ' ' || translate(subject_type, '._-', '   ')
    )
  ) STORED;

CREATE INDEX chronicle_search_idx ON chronicle_events USING GIN (search_document);
