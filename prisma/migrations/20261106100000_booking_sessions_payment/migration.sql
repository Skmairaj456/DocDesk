-- WhatsApp booking: pick a session (morning/afternoon/evening) before a time, and a sample payment step after booking.
ALTER TYPE "ConversationState" ADD VALUE IF NOT EXISTS 'SELECTING_SESSION' AFTER 'SELECTING_DATE';
ALTER TYPE "ConversationState" ADD VALUE IF NOT EXISTS 'SELECTING_PAYMENT' AFTER 'CONFIRMING_BOOKING';
