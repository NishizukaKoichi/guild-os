ALTER TABLE announcements
  DROP CONSTRAINT announcements_publication_state,
  DROP CONSTRAINT announcements_expiry_order;

ALTER TABLE announcements
  ADD CONSTRAINT announcements_publication_state CHECK (
    (status = 'draft' AND published_at IS NULL)
    OR (status = 'published' AND published_at IS NOT NULL)
    OR status = 'archived'
  ),
  ADD CONSTRAINT announcements_expiry_order CHECK (
    expires_at IS NULL
    OR (published_at IS NULL AND expires_at > created_at)
    OR (published_at IS NOT NULL AND expires_at > published_at)
  );
