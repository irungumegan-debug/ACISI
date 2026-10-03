-- Clinic-defined departments: short code, optional consultation fee,
-- case-insensitive unique names, and doctors in several departments.
-- Additive only: every existing department, visit, appointment and doctor
-- keeps pointing where it did.

-- 1. New columns, nullable first so existing rows can be backfilled.
ALTER TABLE "departments" ADD COLUMN "code" TEXT,
ADD COLUMN "consultationFeeKes" INTEGER,
ADD COLUMN "nameKey" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 2. Backfill nameKey (lower-cased name) and a short code from the name
--    (first three letters/digits, e.g. "General" -> "GEN"), numbering any
--    that would clash within the same clinic ("GEN", "GEN2", ...).
WITH prepared AS (
  SELECT
    id,
    "clinicId",
    "createdAt",
    lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) AS key,
    CASE
      WHEN length(regexp_replace(upper(name), '[^A-Z0-9]', '', 'g')) >= 2
        THEN left(regexp_replace(upper(name), '[^A-Z0-9]', '', 'g'), 3)
      ELSE 'DEP'
    END AS base
  FROM "departments"
),
numbered AS (
  SELECT
    id,
    key,
    base,
    row_number() OVER (PARTITION BY "clinicId", key ORDER BY "createdAt", id) AS key_n,
    row_number() OVER (PARTITION BY "clinicId", base ORDER BY "createdAt", id) AS code_n
  FROM prepared
)
UPDATE "departments" d
SET
  "nameKey" = CASE WHEN n.key_n = 1 THEN n.key ELSE n.key || ' #' || n.key_n END,
  "code" = CASE WHEN n.code_n = 1 THEN n.base ELSE n.base || n.code_n END
FROM numbered n
WHERE d.id = n.id;

ALTER TABLE "departments" ALTER COLUMN "code" SET NOT NULL,
ALTER COLUMN "nameKey" SET NOT NULL;

-- 3. Swap the case-sensitive name constraint for the case-insensitive one, add the code one.
DROP INDEX "departments_clinicId_name_key";
CREATE UNIQUE INDEX "departments_clinicId_nameKey_key" ON "departments"("clinicId", "nameKey");
CREATE UNIQUE INDEX "departments_clinicId_code_key" ON "departments"("clinicId", "code");

-- 4. Doctors <-> departments (many-to-many).
CREATE TABLE "staff_departments" (
    "staffId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_departments_pkey" PRIMARY KEY ("staffId","departmentId")
);
CREATE INDEX "staff_departments_departmentId_idx" ON "staff_departments"("departmentId");
ALTER TABLE "staff_departments" ADD CONSTRAINT "staff_departments_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_departments" ADD CONSTRAINT "staff_departments_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Every staff member's current department becomes their first link.
INSERT INTO "staff_departments" ("staffId", "departmentId")
SELECT id, "departmentId" FROM "staff" WHERE "departmentId" IS NOT NULL;
