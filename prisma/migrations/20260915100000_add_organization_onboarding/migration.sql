ALTER TABLE "Organization"
ADD COLUMN "onboardingData" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "onboardingStep" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);
