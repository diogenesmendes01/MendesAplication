/**
 * Script de teste — NFS-e Taboão da Serra (CONAM)
 * ⚠️  CONAM pode não ter ambiente de homologação separado — confirmar antes de rodar!
 * Uso:
 *   TOKEN1=usuarioWS \
 *   TOKEN2=senhaWS \
 *   INSCRICAO_MUNICIPAL=12345678 \
 *   CNPJ=00000000000100 \
 *   ITEM_LISTA=01.07 \
 *   npx tsx scripts/test-nfse-taboao.ts
 */

import { TaboaoDaSerraNfseProvider } from "../src/lib/nfse/taboao.provider";

async function main() {
  const token1           = process.env.TOKEN1;
  const token2           = process.env.TOKEN2;
  const inscricao        = process.env.INSCRICAO_MUNICIPAL;
  const cnpj             = process.env.CNPJ;
  const itemListaServico = process.env.ITEM_LISTA ?? "01.07";

  if (!token1 || !token2 || !inscricao || !cnpj) {
    console.error("❌  Variáveis obrigatórias: TOKEN1, TOKEN2, INSCRICAO_MUNICIPAL, CNPJ");
    process.exit(1);
  }

  console.log("🔧  Provider: Taboão da Serra (CONAM)");
  console.log(`⚠️   Sem NFSE_ENV — verificar se CONAM tem homologação separada`);
  console.log(`🏢  CNPJ: ${cnpj} | IM: ${inscricao} | LC116: ${itemListaServico}`);
  console.log("");

  const provider = new TaboaoDaSerraNfseProvider(
    token1,
    token2,
    inscricao,
    itemListaServico
  );

  console.log("📡  Enviando NFS-e de teste (R$ 1,00)...");

  const result = await provider.emitNFSe({
    companyData: {
      razaoSocial: "EMPRESA TESTE LTDA",
      cnpj,
      inscricaoEstadual: null,
    },
    clientData: {
      name: "TOMADOR TESTE LTDA",
      cpfCnpj: "11222333000181",
      email: "teste@teste.com",
      endereco: null,
    },
    serviceDescription: "Teste de integração NFS-e — Vex/MendesERP",
    value: 1.00,
    issRate: 2.0,
  });

  console.log("");
  console.log("✅  NFS-e emitida com sucesso!");
  console.log(`🔢  Número: ${result.nfNumber}`);
}

main().catch((err) => {
  console.error("");
  console.error("❌  Erro na emissão:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
