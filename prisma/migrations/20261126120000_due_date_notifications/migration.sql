ALTER TABLE "AppNotification"
  ADD COLUMN "recipientId" UUID,
  ADD COLUMN "dedupeKey" TEXT,
  ADD COLUMN "emailSentAt" TIMESTAMP(3),
  ADD COLUMN "emailAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "emailLastError" TEXT,
  ADD COLUMN "pushSentAt" TIMESTAMP(3),
  ADD COLUMN "pushAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "pushLastError" TEXT;

CREATE UNIQUE INDEX "AppNotification_dedupeKey_key" ON "AppNotification"("dedupeKey");
CREATE INDEX "AppNotification_recipientId_createdAt_idx" ON "AppNotification"("recipientId", "createdAt");
ALTER TABLE "AppNotification" ADD CONSTRAINT "AppNotification_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PushSubscription" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_organizationId_userId_idx" ON "PushSubscription"("organizationId", "userId");
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
