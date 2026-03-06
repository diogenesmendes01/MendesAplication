/**
 * Factory: seleciona o provider NFS-e correto baseado no codigoMunicipio da empresa
 */

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import type { NfseProvider } from "../nfse";
import { MockNfseProvider } from "../nfse";
import { CampinasNfseProvider } from "./campinas.provider";
import { SaoPauloNfseProvider } from "./saopaulo.provider";
import { TaboaoDaSerraNfseProvider } from "./taboao.provider";

const MUNICIPIOS = {
  CAMPINAS: "3509502",
  SAO_PAULO: "3550308",
  TABOAO_DA_SERRA: "3552809",
} as const;

// ---------------------------------------------------------------------------
// Cache de providers por empresa — evita re-parse do certificado a cada emissão
// TTL de 10 minutos; invalidado automaticamente quando o config é salvo
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

interface CacheEntry {
  provider: NfseProvider;
  expiresAt: number;
}

const providerCache = new Map<string, CacheEntry>();

/** Invalida o cache de um provider (chamar ao salvar certificado ou config fiscal) */
export function invalidateNfseProviderCache(companyId: string): void {
  providerCache.delete(companyId);
}

export async function getNfseProviderForCompany(
  companyId: string
): Promise<NfseProvider> {
  // Verifica cache antes de ir ao banco e re-parsear o certificado
  const cached = providerCache.get(companyId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.provider;
  }

  const config = await prisma.fiscalConfig.findUnique({
    where: { companyId },
    select: {
      codigoMunicipio: true,
      inscricaoMunicipal: true,
      certificadoPfx: true,
      certificadoSenha: true,
      certificadoToken1: true,
      certificadoToken2: true,
      itemListaServico: true,
      codigoTributacaoMunicipio: true,
      cnae: true,
      taxRegime: true,
    },
  });

  if (!config) {
    throw new Error(
      "Configuração fiscal não encontrada. Acesse Configurações → Fiscal para configurar."
    );
  }

  const { codigoMunicipio, inscricaoMunicipal, itemListaServico } = config;

  if (!codigoMunicipio) {
    throw new Error(
      "Código do Município não configurado. Acesse Configurações → Fiscal."
    );
  }

  if (!inscricaoMunicipal) {
    throw new Error(
      "Inscrição Municipal não configurada. Acesse Configurações → Fiscal."
    );
  }

  if (!itemListaServico) {
    throw new Error(
      "Código de Serviço LC116 não configurado. Acesse Configurações → Fiscal."
    );
  }

  // --- Taboão da Serra (autenticação por tokens, sem certificado) ---
  if (codigoMunicipio === MUNICIPIOS.TABOAO_DA_SERRA) {
    if (!config.certificadoToken1 || !config.certificadoToken2) {
      throw new Error(
        "Tokens de acesso não configurados para Taboão da Serra. Acesse Configurações → Fiscal."
      );
    }

    // Decripta os tokens antes de usar
    const token1 = decrypt(config.certificadoToken1);
    const token2 = decrypt(config.certificadoToken2);

    const taboaoProvider = new TaboaoDaSerraNfseProvider(
      token1,
      token2,
      inscricaoMunicipal,
      itemListaServico,
      {
        // Códigos para serviço 01.07 — Suporte técnico em TI (LC 214/2025)
        // Fonte: portal eTransparência Taboão → TABELAS – SISTEMA NACIONAL
        codCTN: "01.07.01.000",
        codNBS: "1.1501.30.00",
        cClassTrib: "000001",
      }
    );
    providerCache.set(companyId, { provider: taboaoProvider, expiresAt: Date.now() + CACHE_TTL_MS });
    return taboaoProvider;
  }

  // --- Campinas e São Paulo (autenticação por certificado A1) ---
  if (!config.certificadoPfx) {
    throw new Error(
      "Certificado Digital (.pfx) não configurado. Acesse Configurações → Fiscal."
    );
  }

  if (!config.certificadoSenha) {
    throw new Error(
      "Senha do Certificado Digital não configurada. Acesse Configurações → Fiscal."
    );
  }

  // Decripta senha e converte pfx de base64 para Buffer
  const certPassword = decrypt(config.certificadoSenha);
  const certPfxBase64 = decrypt(config.certificadoPfx);
  const certBuffer = Buffer.from(certPfxBase64, "base64");

  switch (codigoMunicipio) {
    case MUNICIPIOS.CAMPINAS: {
      // O constructor do CampinasNfseProvider já normaliza o CNAE internamente.
      // Passamos o valor bruto do banco; a normalização (remoção de não-dígitos) é feita lá.
      const cnaeNormalizado = config.cnae ?? undefined;
      // OptanteSimplesNacional: aplica-se ao schema ABRASF (Campinas).
      // São Paulo (Nota Paulistana v1) usa TributacaoRPS="T" sem este campo.
      // Taboão da Serra (CONAM) usa cClassTrib/codNBS sem equivalente de Simples.
      const isSimples = config.taxRegime === "SIMPLES_NACIONAL";
      const campinasProvider = new CampinasNfseProvider(
        certBuffer,
        certPassword,
        inscricaoMunicipal,
        itemListaServico,
        config.codigoTributacaoMunicipio ?? undefined,
        cnaeNormalizado,
        isSimples
      );
      providerCache.set(companyId, { provider: campinasProvider, expiresAt: Date.now() + CACHE_TTL_MS });
      return campinasProvider;
    }

    case MUNICIPIOS.SAO_PAULO: {
      const spProvider = new SaoPauloNfseProvider(
        certBuffer,
        certPassword,
        inscricaoMunicipal,
        itemListaServico,
        config.codigoTributacaoMunicipio ?? ""
      );
      providerCache.set(companyId, { provider: spProvider, expiresAt: Date.now() + CACHE_TTL_MS });
      return spProvider;
    }

    default:
      throw new Error(
        `Município "${codigoMunicipio}" não suportado para emissão automática de NFS-e. ` +
          `Municípios suportados: Campinas (${MUNICIPIOS.CAMPINAS}), ` +
          `São Paulo (${MUNICIPIOS.SAO_PAULO}), ` +
          `Taboão da Serra (${MUNICIPIOS.TABOAO_DA_SERRA}).`
      );
  }
}

// Exporta também o Mock para testes
export { MockNfseProvider };
