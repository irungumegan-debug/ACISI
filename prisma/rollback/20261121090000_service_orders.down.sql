-- Undo for prisma/migrations/20261121090000_service_orders. NOT run
-- automatically. Run by hand only to roll that migration back, after
-- deploying the previous version of the app:
--
--   sudo -u postgres psql acisi -f prisma/rollback/20261121090000_service_orders.down.sql
--   sudo -u postgres psql acisi -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261121090000_service_orders'"
--
-- Deletes every radiology, therapy, nutrition, social work and counselling order.

BEGIN;
DROP TABLE IF EXISTS "service_orders";
DROP TYPE IF EXISTS "ServiceOrderStatus";
DROP TYPE IF EXISTS "ServiceOrderCategory";
COMMIT;
