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

export async function getNfseProviderForCompany(
  companyId: string
): Promise<NfseProvider> {
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

    return new TaboaoDaSerraNfseProvider(
      token1,
      token2,
      inscricaoMunicipal,
      itemListaServico
    );
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
    case MUNICIPIOS.CAMPINAS:
      return new CampinasNfseProvider(
        certBuffer,
        certPassword,
        inscricaoMunicipal,
        itemListaServico,
        config.codigoTributacaoMunicipio ?? undefined
      );

    case MUNICIPIOS.SAO_PAULO:
      return new SaoPauloNfseProvider(
        certBuffer,
        certPassword,
        inscricaoMunicipal,
        itemListaServico,
        config.codigoTributacaoMunicipio ?? ""
      );

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
