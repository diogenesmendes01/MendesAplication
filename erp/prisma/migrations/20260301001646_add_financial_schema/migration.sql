-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('PF', 'PJ');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "FinancialCategoryType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "Recurrence" AS ENUM ('NONE', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "razaoSocial" TEXT,
    "cpfCnpj" TEXT NOT NULL,
    "email" TEXT,
    "telefone" TEXT,
    "endereco" TEXT,
    "type" "ClientType" NOT NULL DEFAULT 'PF',
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FinancialCategoryType" NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "financial_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts_receivable" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_receivable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts_payable" (
    "id" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "categoryId" TEXT,
    "recurrence" "Recurrence" NOT NULL DEFAULT 'NONE',
    "paidAt" TIMESTAMP(3),
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_payable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_cpfCnpj_companyId_key" ON "clients"("cpfCnpj", "companyId");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "financial_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
