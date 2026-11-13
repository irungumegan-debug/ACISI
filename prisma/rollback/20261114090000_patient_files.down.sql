-- Undo for prisma/migrations/20261114090000_patient_files. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261114090000_patient_files.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261114090000_patient_files'"
--
-- Removes the record of every uploaded file. The files themselves stay on
-- disk in FILE_STORAGE_DIR (and in the backups) until deleted by hand:
--   sudo rm -rf /var/lib/acisi/files
-- Nothing else is touched.

BEGIN;
DROP TABLE IF EXISTS "patient_files";
DROP TYPE IF EXISTS "PatientFileCategory";
COMMIT;
