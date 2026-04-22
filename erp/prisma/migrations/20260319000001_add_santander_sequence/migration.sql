-- CreateTable
CREATE TABLE "santander_sequences" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "covenantCode" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "santander_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "santander_sequences_companyId_covenantCode_key" ON "santander_sequences"("companyId", "covenantCode");

-- AddForeignKey
ALTER TABLE "santander_sequences" ADD CONSTRAINT "santander_sequences_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
