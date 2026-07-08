-- Add per-project ZeptoMail custom webhook authorization header settings.
ALTER TABLE "projects" ADD COLUMN "zeptomailWebhookHeaderKey" TEXT;
ALTER TABLE "projects" ADD COLUMN "zeptomailWebhookHeaderValue" TEXT;
