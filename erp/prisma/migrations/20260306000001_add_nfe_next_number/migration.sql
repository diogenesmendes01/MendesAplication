-- AlterTable: adiciona controle de numeração atômica para NF-e Modelo 55
ALTER TABLE "fiscal_configs" ADD COLUMN "nfeSerieNumber" TEXT NOT NULL DEFAULT '1';
ALTER TABLE "fiscal_configs" ADD COLUMN "nfeNextNumber" INTEGER NOT NULL DEFAULT 1;
