-- AlterTable
ALTER TABLE "automation_jobs" ADD COLUMN     "default_message" TEXT,
ADD COLUMN     "total_tokens" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "message_records" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "message_sent" TEXT,
    "status" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL DEFAULT 0,
    "error_reason" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_records_job_id_idx" ON "message_records"("job_id");

-- AddForeignKey
ALTER TABLE "message_records" ADD CONSTRAINT "message_records_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "automation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
