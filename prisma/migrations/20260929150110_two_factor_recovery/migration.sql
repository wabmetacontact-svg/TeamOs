-- AlterTable
ALTER TABLE "users" ADD COLUMN     "twoFactorAddedAt" TIMESTAMP(3),
ADD COLUMN     "twoFactorRecovery" TEXT[] DEFAULT ARRAY[]::TEXT[];
