ALTER TABLE "WhatsAppConversation"
  ADD COLUMN "lastInboundAt" TIMESTAMPTZ(3),
  ADD COLUMN "optedOutAt" TIMESTAMPTZ(3);
