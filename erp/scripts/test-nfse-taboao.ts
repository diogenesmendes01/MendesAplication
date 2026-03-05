/**
 * Script de teste — NFS-e Taboão da Serra (eTransparência)
 * Uso:
 *   CODIGO_USUARIO=XXX \
 *   CODIGO_CONTRIBUINTE=YYY \
 *   INSCRICAO_MUNICIPAL=12345678 \
 *   CNPJ=00000000000100 \
 *   ITEM_LISTA=01.07 \
 *   NFSE_ENV=homolog|production \
 *   npx tsx scripts/test-nfse-taboao.ts
 *
 * CodigoUsuario: obtido no portal eTransparência em perfil do usuário
 * CodigoContribuinte: código do contribuinte autorizado na prefeitura
 */

import { TaboaoDaSerraNfseProvider } from "../src/lib/nfse/taboao.provider";

async function main() {
  const codigoUsuario      = process.env.CODIGO_USUARIO;
  const codigoContribuinte = process.env.CODIGO_CONTRIBUINTE;
  const inscricao          = process.env.INSCRICAO_MUNICIPAL;
  const cnpj               = process.env.CNPJ;
  const itemListaServico   = process.env.ITEM_LISTA ?? "01.07";
  const env                = process.env.NFSE_ENV ?? "homolog";

  if (!codigoUsuario || !codigoContribuinte || !inscricao || !cnpj) {
    console.error("❌  Variáveis obrigatórias: CODIGO_USUARIO, CODIGO_CONTRIBUINTE, INSCRICAO_MUNICIPAL, CNPJ");
    process.exit(1);
  }

  console.log("🔧  Provider: Taboão da Serra (eTransparência)");
  console.log(`🌐  Ambiente: ${env === "production" ? "PRODUÇÃO ⚠️" : "Homologação ✅"}`);
  console.log(`🏢  CNPJ: ${cnpj} | IM: ${inscricao} | LC116: ${itemListaServico}`);
  console.log("");

  const provider = new TaboaoDaSerraNfseProvider(
    codigoUsuario,
    codigoContribuinte,
    inscricao,
    itemListaServico
  );

  console.log("📡  Enviando NFS-e de teste (R$ 1,00)...");

  const result = await provider.emitNFSe({
    companyData: {
      razaoSocial: "M2 SOLUÇÕES EM NUVEM LTDA",
      cnpj,
      inscricaoEstadual: null,
    },
    clientData: {
      name: "TOMADOR TESTE LTDA",
      cpfCnpj: "11222333000181",
      email: "teste@teste.com",
      endereco: "Rua Teste, 123 - Centro",
    },
    serviceDescription: "Teste de integração NFS-e — Vex/MendesERP",
    value: 1.00,
    issRate: 2.0,
  });

  console.log("");
  console.log("✅  NFS-e emitida com sucesso!");
  console.log(`🔢  Número/Protocolo: ${result.nfNumber}`);
}

main().catch((err) => {
  console.error("");
  console.error("❌  Erro na emissão:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
