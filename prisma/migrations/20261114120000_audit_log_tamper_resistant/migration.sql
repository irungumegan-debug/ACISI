-- Tamper-resistant audit log (DHA self-attestation, DPIA action A5).
-- 1. Every row carries a SHA-256 hash chained to the previous row's hash,
--    computed by the database itself, so altering or removing an earlier
--    row is detectable (npm run verify-audit-log).
-- 2. The database refuses UPDATE, DELETE and TRUNCATE on audit_logs.
-- Additive: two new nullable columns, functions and triggers. Existing rows
-- are chained once, in creation order. Undo:
-- prisma/rollback/20261114120000_audit_log_tamper_resistant.down.sql

ALTER TABLE "audit_logs" ADD COLUMN "prevHash" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "hash" TEXT;

-- The content that is hashed: every column, in a fixed order, separated by
-- a character that cannot appear in IDs. The timestamp is in milliseconds
-- since 1970 (UTC, the column's precision) so it never depends on a session's time zone or format.
CREATE FUNCTION audit_log_row_text(r "audit_logs") RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws(chr(31),
    r."id", r."actorType"::text, coalesce(r."actorId", ''), coalesce(r."staffId", ''),
    r."action", r."entityType", coalesce(r."entityId", ''), coalesce(r."clinicId", ''),
    coalesce(r."metadata"::text, ''),
    (floor(extract(epoch FROM r."createdAt") * 1000))::bigint::text)
$$;

-- Chain the rows that already exist, oldest first.
DO $$
DECLARE
  r "audit_logs";
  prev TEXT := '';
BEGIN
  FOR r IN SELECT * FROM "audit_logs" ORDER BY "createdAt", "id" LOOP
    UPDATE "audit_logs"
      SET "prevHash" = prev,
          "hash" = encode(sha256(convert_to(prev || chr(30) || audit_log_row_text(r), 'UTF8')), 'hex')
      WHERE "id" = r."id"
      RETURNING "hash" INTO prev;
  END LOOP;
END $$;

-- New rows: one writer at a time (a transaction-level lock), so the chain
-- never forks. Audit writes are small and quick, so this is cheap.
CREATE FUNCTION audit_logs_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prev TEXT;
  prev_at TIMESTAMP(3);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('acisi_audit_logs_chain'));
  SELECT "hash", "createdAt" INTO prev, prev_at FROM "audit_logs" WHERE "hash" IS NOT NULL ORDER BY "createdAt" DESC, "id" DESC LIMIT 1;
  -- Stamp the row with the real time of insertion (taken while holding the
  -- lock, and always after the previous row), so the newest row is always
  -- the end of the chain.
  NEW."createdAt" := greatest((clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3), coalesce(prev_at + interval '1 millisecond', (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)));
  NEW."prevHash" := coalesce(prev, '');
  NEW."hash" := encode(sha256(convert_to(NEW."prevHash" || chr(30) || audit_log_row_text(NEW), 'UTF8')), 'hex');
  RETURN NEW;
END $$;

CREATE TRIGGER audit_logs_chain BEFORE INSERT ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_chain();

CREATE FUNCTION audit_logs_refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_refuse_change();

CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_refuse_change();
