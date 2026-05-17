-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('free', 'pro', 'business');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('active', 'paused', 'error', 'disconnected');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('idle', 'running', 'stopped', 'done', 'error');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'free',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ig_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "proxy" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'active',
    "last_active_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ig_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ig_account_id" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'idle',
    "total_targets" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "stopped_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_logs" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "ig_accounts_user_id_idx" ON "ig_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ig_accounts_user_id_username_key" ON "ig_accounts"("user_id", "username");

-- CreateIndex
CREATE INDEX "automation_jobs_user_id_status_idx" ON "automation_jobs"("user_id", "status");

-- CreateIndex
CREATE INDEX "job_logs_job_id_created_at_idx" ON "job_logs"("job_id", "created_at");

-- AddForeignKey
ALTER TABLE "ig_accounts" ADD CONSTRAINT "ig_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_jobs" ADD CONSTRAINT "automation_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_jobs" ADD CONSTRAINT "automation_jobs_ig_account_id_fkey" FOREIGN KEY ("ig_account_id") REFERENCES "ig_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_logs" ADD CONSTRAINT "job_logs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "automation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
