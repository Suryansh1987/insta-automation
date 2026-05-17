ALTER TYPE "Plan" RENAME VALUE 'business' TO 'max';

CREATE TYPE "SubscriptionStatus" AS ENUM ('created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'expired');
CREATE TYPE "BillingAttemptStatus" AS ENUM ('created', 'completed', 'failed');
CREATE TYPE "WebhookProcessStatus" AS ENUM ('received', 'processed', 'failed');
CREATE TYPE "UsageMetric" AS ENUM ('message_attempt');

CREATE TABLE "subscriptions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "plan" "Plan" NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'razorpay',
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'created',
  "provider_subscription_id" TEXT,
  "provider_customer_id" TEXT,
  "short_url" TEXT,
  "current_start" TIMESTAMP(3),
  "current_end" TIMESTAMP(3),
  "cancel_at_cycle_end" BOOLEAN NOT NULL DEFAULT false,
  "last_payment_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_attempts" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "subscription_id" TEXT,
  "target_plan" "Plan" NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'razorpay',
  "status" "BillingAttemptStatus" NOT NULL DEFAULT 'created',
  "idempotency_key" TEXT NOT NULL,
  "provider_subscription_id" TEXT,
  "provider_payment_id" TEXT,
  "error_code" TEXT,
  "error_description" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "billing_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_events" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'razorpay',
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "signature" TEXT,
  "status" "WebhookProcessStatus" NOT NULL DEFAULT 'received',
  "payload" JSONB NOT NULL,
  "error" TEXT,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "daily_usage_counters" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "usage_date" DATE NOT NULL,
  "metric" "UsageMetric" NOT NULL,
  "used" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "daily_usage_counters_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "usage_events" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "counter_id" TEXT NOT NULL,
  "metric" "UsageMetric" NOT NULL,
  "usage_date" DATE NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "idempotency_key" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscriptions_provider_subscription_id_key" ON "subscriptions"("provider_subscription_id");
CREATE INDEX "subscriptions_user_id_created_at_idx" ON "subscriptions"("user_id", "created_at");

CREATE UNIQUE INDEX "billing_attempts_idempotency_key_key" ON "billing_attempts"("idempotency_key");
CREATE INDEX "billing_attempts_user_id_created_at_idx" ON "billing_attempts"("user_id", "created_at");

CREATE UNIQUE INDEX "webhook_events_provider_event_id_key" ON "webhook_events"("provider", "event_id");
CREATE INDEX "webhook_events_event_type_created_at_idx" ON "webhook_events"("event_type", "created_at");

CREATE UNIQUE INDEX "daily_usage_counters_user_id_usage_date_metric_key" ON "daily_usage_counters"("user_id", "usage_date", "metric");
CREATE INDEX "daily_usage_counters_user_id_usage_date_idx" ON "daily_usage_counters"("user_id", "usage_date");

CREATE UNIQUE INDEX "usage_events_idempotency_key_key" ON "usage_events"("idempotency_key");
CREATE INDEX "usage_events_user_id_usage_date_idx" ON "usage_events"("user_id", "usage_date");

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_attempts"
  ADD CONSTRAINT "billing_attempts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_attempts"
  ADD CONSTRAINT "billing_attempts_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "daily_usage_counters"
  ADD CONSTRAINT "daily_usage_counters_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "usage_events"
  ADD CONSTRAINT "usage_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "usage_events"
  ADD CONSTRAINT "usage_events_counter_id_fkey"
  FOREIGN KEY ("counter_id") REFERENCES "daily_usage_counters"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
