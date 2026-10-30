-- C20 addition: count "Resend prompt" presses per check-in (at most 3).
-- Additive only: one new column with a default; existing rows get 0.
-- Undo: prisma/rollback/20261101090000_checkin_prompt_resends.down.sql
ALTER TABLE "check_ins" ADD COLUMN "paymentPromptResends" INTEGER NOT NULL DEFAULT 0;
