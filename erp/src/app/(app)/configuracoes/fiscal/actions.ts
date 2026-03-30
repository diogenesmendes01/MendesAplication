"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import { encrypt } from "@/lib/encryption";
import { invalidateNfseProviderCache } from "@/lib/nfse/factory";
import { Prisma } from "@prisma/client";
import type { TaxRegime } from "@prisma/client";
import { withLogging } from "@/lib/with-logging";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FiscalConfigData {
  taxRegime: TaxRegime;
  issRate: number;
  pisRate: number;
  cofinsRate: number;
  irpjRate: number;
  csllRate: number;
  cnae: string;
  inscricaoMunicipal: string;
  codigoMunicipio: string;
  nfseSerieNumber: string;
  nfseNextNumber: number;
  autoEmitNfse: boolean;
  // NFS-e — campos sensíveis (não retornados ao cliente em plain text)
  itemListaServico: string;
  codigoTributacaoMunicipio: string;
  certificadoToken1: string;
  certificadoToken2: string;
  hasCertificado: boolean; // indica se há .pfx salvo (sem expor o conteúdo)
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

async function _getFiscalConfig(companyId: string): Promise<FiscalConfigData> {
  await requireCompanyAccess(companyId);

  const config = await prisma.fiscalConfig.findUnique({
    where: { companyId },
  });

  if (!config) {
    return {
      taxRegime: "SIMPLES_NACIONAL",
      issRate: 5,
      pisRate: 0,
      cofinsRate: 0,
      irpjRate: 0,
      csllRate: 0,
      cnae: "",
      inscricaoMunicipal: "",
      codigoMunicipio: "",
      nfseSerieNumber: "1",
      nfseNextNumber: 1,
      autoEmitNfse: false,
      itemListaServico: "",
      codigoTributacaoMunicipio: "",
      certificadoToken1: "",
      certificadoToken2: "",
      hasCertificado: false,
    };
  }

  return {
    taxRegime: config.taxRegime,
    issRate: Number(config.issRate),
    pisRate: Number(config.pisRate),
    cofinsRate: Number(config.cofinsRate),
    irpjRate: Number(config.irpjRate),
    csllRate: Number(config.csllRate),
    cnae: config.cnae ?? "",
    inscricaoMunicipal: config.inscricaoMunicipal ?? "",
    codigoMunicipio: config.codigoMunicipio ?? "",
    nfseSerieNumber: config.nfseSerieNumber,
    nfseNextNumber: config.nfseNextNumber,
    autoEmitNfse: config.autoEmitNfse,
    itemListaServico: config.itemListaServico ?? "",
    codigoTributacaoMunicipio: config.codigoTributacaoMunicipio ?? "",
    // Tokens mascarados — nunca expostos ao cliente em plain text
    certificadoToken1: config.certificadoToken1 ? "••••••••" : "",
    certificadoToken2: config.certificadoToken2 ? "••••••••" : "",
    // Apenas informa se há certificado — nunca expõe o .pfx ao cliente
    hasCertificado: !!config.certificadoPfx,
  };
}

/**
 * Salva o certificado .pfx (base64) e sua senha de forma encriptada.
 * Ação separada para evitar reenvio do arquivo a cada save de config.
 */
async function _saveCertificado(
  companyId: string,
  pfxBase64: string,
  senha: string
): Promise<{ success: true }> {
  await requireCompanyAccess(companyId);

  const encryptedPfx = encrypt(pfxBase64);
  const encryptedSenha = encrypt(senha);

  await prisma.fiscalConfig.upsert({
    where: { companyId },
    create: {
      companyId,
      certificadoPfx: encryptedPfx,
      certificadoSenha: encryptedSenha,
    },
    update: {
      certificadoPfx: encryptedPfx,
      certificadoSenha: encryptedSenha,
    },
  });

  fiscalConfigCache.delete(companyId);
  invalidateNfseProviderCache(companyId);
  return { success: true };
}

async function _saveFiscalConfig(companyId: string, data: FiscalConfigData) {
  const session = await requireCompanyAccess(companyId);

  // Server-side validation
  const rateFields = ["issRate", "pisRate", "cofinsRate", "irpjRate", "csllRate"] as const;
  for (const field of rateFields) {
    const v = data[field];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) {
      throw new Error(`Alíquota ${field.replace("Rate", "").toUpperCase()} deve ser um número entre 0 e 100`);
    }
  }

  const validRegimes = ["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL"];
  if (!validRegimes.includes(data.taxRegime)) {
    throw new Error("Regime tributário inválido");
  }

  if (typeof data.nfseNextNumber !== "number" || !Number.isFinite(data.nfseNextNumber) || data.nfseNextNumber < 1) {
    throw new Error("Próximo número da NFS-e deve ser >= 1");
  }

  // Nunca sobrescreve tokens com o valor mascarado retornado ao cliente
  const MASKED = "••••••••";
  const baseData = {
    taxRegime: data.taxRegime,
    issRate: data.issRate,
    pisRate: data.pisRate,
    cofinsRate: data.cofinsRate,
    irpjRate: data.irpjRate,
    csllRate: data.csllRate,
    cnae: data.cnae || null,
    inscricaoMunicipal: data.inscricaoMunicipal || null,
    codigoMunicipio: data.codigoMunicipio || null,
    nfseSerieNumber: data.nfseSerieNumber || "1",
    nfseNextNumber: data.nfseNextNumber || 1,
    autoEmitNfse: data.autoEmitNfse,
    itemListaServico: data.itemListaServico || null,
    codigoTributacaoMunicipio: data.codigoTributacaoMunicipio || null,
    // Tokens são salvos apenas via saveTokensConam — ignorados aqui se mascarados
    ...(data.certificadoToken1 && data.certificadoToken1 !== MASKED
      ? { certificadoToken1: encrypt(data.certificadoToken1) }
      : {}),
    ...(data.certificadoToken2 && data.certificadoToken2 !== MASKED
      ? { certificadoToken2: encrypt(data.certificadoToken2) }
      : {}),
  };

  const result = await prisma.fiscalConfig.upsert({
    where: { companyId },
    create: { companyId, ...baseData },
    update: baseData,
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "FiscalConfig",
    entityId: result.id,
    dataAfter: data as unknown as Prisma.InputJsonValue,
    companyId,
  });

  // Limpa caches ao salvar config
  fiscalConfigCache.delete(companyId);
  invalidateNfseProviderCache(companyId);

  return { success: true };
}

// ---------------------------------------------------------------------------
// Cached fetch for use by other modules (emitInvoice, etc.)
// ---------------------------------------------------------------------------

const fiscalConfigCache = new Map<string, { data: FiscalConfigData; timestamp: number }>();
const FISCAL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function _getCachedFiscalConfig(companyId: string): Promise<FiscalConfigData> {
  const cached = fiscalConfigCache.get(companyId);
  if (cached && Date.now() - cached.timestamp < FISCAL_CACHE_TTL) {
    return cached.data;
  }

  const config = await prisma.fiscalConfig.findUnique({
    where: { companyId },
  });

  const data: FiscalConfigData = config
    ? {
        taxRegime: config.taxRegime,
        issRate: Number(config.issRate),
        pisRate: Number(config.pisRate),
        cofinsRate: Number(config.cofinsRate),
        irpjRate: Number(config.irpjRate),
        csllRate: Number(config.csllRate),
        cnae: config.cnae ?? "",
        inscricaoMunicipal: config.inscricaoMunicipal ?? "",
        codigoMunicipio: config.codigoMunicipio ?? "",
        nfseSerieNumber: config.nfseSerieNumber,
        nfseNextNumber: config.nfseNextNumber,
        autoEmitNfse: config.autoEmitNfse,
        itemListaServico: config.itemListaServico ?? "",
        codigoTributacaoMunicipio: config.codigoTributacaoMunicipio ?? "",
        certificadoToken1: config.certificadoToken1 ?? "",
        certificadoToken2: config.certificadoToken2 ?? "",
        hasCertificado: !!config.certificadoPfx,
      }
    : {
        taxRegime: "SIMPLES_NACIONAL",
        issRate: 5,
        pisRate: 0,
        cofinsRate: 0,
        irpjRate: 0,
        csllRate: 0,
        cnae: "",
        inscricaoMunicipal: "",
        codigoMunicipio: "",
        nfseSerieNumber: "1",
        nfseNextNumber: 1,
        autoEmitNfse: false,
        itemListaServico: "",
        codigoTributacaoMunicipio: "",
        certificadoToken1: "",
        certificadoToken2: "",
        hasCertificado: false,
      };

  fiscalConfigCache.set(companyId, { data, timestamp: Date.now() });
  return data;
}

export { fiscalConfigCache };

// ---------------------------------------------------------------------------
// Wrapped exports with logging
// ---------------------------------------------------------------------------
const _wrapped_getFiscalConfig = withLogging('fiscal.getFiscalConfig', _getFiscalConfig);
export async function getFiscalConfig(...args: Parameters<typeof _getFiscalConfig>) { return _wrapped_getFiscalConfig(...args); }
const _wrapped_saveCertificado = withLogging('fiscal.saveCertificado', _saveCertificado);
export async function saveCertificado(...args: Parameters<typeof _saveCertificado>) { return _wrapped_saveCertificado(...args); }
const _wrapped_saveFiscalConfig = withLogging('fiscal.saveFiscalConfig', _saveFiscalConfig);
export async function saveFiscalConfig(...args: Parameters<typeof _saveFiscalConfig>) { return _wrapped_saveFiscalConfig(...args); }
const _wrapped_getCachedFiscalConfig = withLogging('fiscal.getCachedFiscalConfig', _getCachedFiscalConfig);
export async function getCachedFiscalConfig(...args: Parameters<typeof _getCachedFiscalConfig>) { return _wrapped_getCachedFiscalConfig(...args); }
