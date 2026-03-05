-- AlterTable: adicionar campos de certificado e serviço NFS-e em FiscalConfig
ALTER TABLE "fiscal_configs"
  ADD COLUMN IF NOT EXISTS "certificadoPfx"            TEXT,
  ADD COLUMN IF NOT EXISTS "certificadoSenha"          TEXT,
  ADD COLUMN IF NOT EXISTS "certificadoToken1"         TEXT,
  ADD COLUMN IF NOT EXISTS "certificadoToken2"         TEXT,
  ADD COLUMN IF NOT EXISTS "itemListaServico"          TEXT,
  ADD COLUMN IF NOT EXISTS "codigoTributacaoMunicipio" TEXT;
