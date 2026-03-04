"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import { Prisma } from "@prisma/client";
import type { TaxRegime } from "@prisma/client";

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
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

export async function getFiscalConfig(companyId: string): Promise<FiscalConfigData> {
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
  };
}

export async function saveFiscalConfig(companyId: string, data: FiscalConfigData) {
  const session = await requireCompanyAccess(companyId);

  const result = await prisma.fiscalConfig.upsert({
    where: { companyId },
    create: {
      companyId,
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
    },
    update: {
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
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "FiscalConfig",
    entityId: result.id,
    dataAfter: data as unknown as Prisma.InputJsonValue,
    companyId,
  });

  // Clear FiscalConfig cache when saved
  fiscalConfigCache.delete(companyId);

  return { success: true };
}

// ---------------------------------------------------------------------------
// Cached fetch for use by other modules (emitInvoice, etc.)
// ---------------------------------------------------------------------------

const fiscalConfigCache = new Map<string, { data: FiscalConfigData; timestamp: number }>();
const FISCAL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getCachedFiscalConfig(companyId: string): Promise<FiscalConfigData> {
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
      };

  fiscalConfigCache.set(companyId, { data, timestamp: Date.now() });
  return data;
}

export { fiscalConfigCache };
