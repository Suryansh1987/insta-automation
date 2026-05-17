-- AlterTable
ALTER TABLE "message_records" ADD COLUMN     "replied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "replied_at" TIMESTAMP(3),
ADD COLUMN     "reply_preview" TEXT,
ADD COLUMN     "seen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "seen_at" TIMESTAMP(3);
