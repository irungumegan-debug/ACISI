-- ICD-11 coded diagnoses on visits. Additive: one optional column.
-- Undo: prisma/rollback/20261114160000_icd11_diagnosis_codes.down.sql

-- AlterTable
ALTER TABLE "encounters" ADD COLUMN     "diagnosisCodes" TEXT;

