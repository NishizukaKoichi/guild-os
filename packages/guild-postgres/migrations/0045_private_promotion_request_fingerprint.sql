BEGIN;

ALTER TABLE private_message_promotions
  ADD COLUMN request_sha256 text
  CHECK (request_sha256 IS NULL OR request_sha256 ~ '^[a-f0-9]{64}$');

COMMENT ON COLUMN private_message_promotions.request_sha256 IS
  'Canonical digest of a promotion request excluding server-assigned IDs. NULL identifies a pre-0045 legacy row.';

COMMIT;
