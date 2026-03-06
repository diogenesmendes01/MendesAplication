/**
 * Script de teste — NFS-e Campinas (ABRASF 2.03)
 * Uso:
 *   CERT_PATH=/caminho/cert.pfx \
 *   CERT_SENHA=senha123 \
 *   INSCRICAO_MUNICIPAL=12345678 \
 *   CNPJ=00000000000100 \
 *   ITEM_LISTA=01.07 \
 *   CNAE=620400001 \
 *   NFSE_ENV=homolog \
 *   npx tsx scripts/test-nfse-campinas.ts
 */

import fs from "fs";
import path from "path";
import { CampinasNfseProvider } from "../src/lib/nfse/campinas.provider";

async function main() {
  const certPath        = process.env.CERT_PATH;
  const certSenha       = process.env.CERT_SENHA;
  const inscricao       = process.env.INSCRICAO_MUNICIPAL;
  const cnpj            = process.env.CNPJ;
  const itemListaServico = process.env.ITEM_LISTA ?? "01.07";
  // Campinas exige CNAE com 9 dígitos — ex: "620400001" para CNAE 6204-0/00-01
  const cnae            = process.env.CNAE?.replace(/\D/g, "") || undefined;

  if (!certPath || !certSenha || !inscricao || !cnpj) {
    console.error("❌  Variáveis obrigatórias: CERT_PATH, CERT_SENHA, INSCRICAO_MUNICIPAL, CNPJ");
    process.exit(1);
  }

  const certBuffer = fs.readFileSync(path.resolve(certPath));

  console.log("🔧  Provider: Campinas (ABRASF 2.03)");
  console.log(`🌐  Ambiente: ${process.env.NFSE_ENV === "production" ? "PRODUÇÃO ⚠️" : "Homologação ✅"}`);
  console.log(`📄  Certificado: ${certPath} (${certBuffer.length} bytes)`);
  console.log(`🏢  CNPJ: ${cnpj} | IM: ${inscricao} | LC116: ${itemListaServico} | CNAE: ${cnae ?? "(não informado)"}`);
  console.log("");

  const provider = new CampinasNfseProvider(
    certBuffer,
    certSenha,
    inscricao,
    itemListaServico,
    undefined,
    cnae
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
      cpfCnpj: "11222333000181", // CNPJ fictício de teste
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
