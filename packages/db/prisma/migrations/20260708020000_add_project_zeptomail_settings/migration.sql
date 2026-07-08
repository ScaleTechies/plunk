-- Add per-project ZeptoMail sending settings.
ALTER TABLE "projects" ADD COLUMN "zeptomailSendToken" TEXT;
ALTER TABLE "projects" ADD COLUMN "zeptomailAgentAlias" TEXT;
ALTER TABLE "projects" ADD COLUMN "zeptomailSenderAddress" TEXT;
