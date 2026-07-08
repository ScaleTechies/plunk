-- Add per-project ZeptoMail webhook authentication key.
ALTER TABLE "projects" ADD COLUMN "zeptomailWebhookAuthKey" TEXT;
