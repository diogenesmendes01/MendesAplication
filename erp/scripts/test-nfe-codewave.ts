/**
 * Teste NF-e — CodeWave Technologies (Livros Digitais)
 * SEFAZ-SP | Modelo 55 | Versão 4.00
 *
 * Uso:
 *   CERT_PATH="path/to/cert.pfx" CERT_SENHA="123456" \
 *   NFE_ENV="homolog" \
 *   NF_NUMERO="1" NF_SERIE="1" \
 *   npx tsx scripts/test-nfe-codewave.ts
 */

import fs from "fs";
import path from "path";
import { SefazSpNfeProvider } from "../src/lib/nfe/sefaz-sp.provider";
import type { EmitNfeInput } from "../src/lib/nfe/index";

async function main() {
  const certPath = process.env.CERT_PATH;
  const certSenha = process.env.CERT_SENHA ?? "123456";
  const nfNumero = parseInt(process.env.NF_NUMERO ?? "1", 10);
  const nfSerie = process.env.NF_SERIE ?? "1";
  const env = process.env.NFE_ENV ?? process.env.NFSE_ENV ?? "homolog";

  if (!certPath) {
    console.error("❌  CERT_PATH não definido");
    process.exit(1);
  }

  console.log("🔧  Provider: SEFAZ-SP (NF-e Modelo 55)");
  console.log(`🌐  Ambiente: ${env === "production" ? "PRODUÇÃO ⚠️" : "Homologação ✅"}`);
  console.log(`📄  NF-e: Série ${nfSerie} | Número ${nfNumero}`);
  console.log("");

  const pfxBuffer = fs.readFileSync(path.resolve(certPath));
  const provider = new SefazSpNfeProvider(pfxBuffer, certSenha);

  const input: EmitNfeInput = {
    companyData: {
      razaoSocial: "CODEWAVE TECHNOLOGIES LTDA",
      cnpj: "54988934000102",
      ie: "137250242116",
      crt: 1, // Simples Nacional
      street: "AVENIDA BRIG FARIA LIMA",
      number: "1811",
      district: "JARDIM PAULISTANO",
      city: "SAO PAULO",
      cityCode: "3550308",
      state: "SP",
      zipCode: "01452001",
    },
    clientData: {
      name: "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL",
      cpfCnpj: "11222333000181", // CNPJ fictício para testes
      ie: "ISENTO",
      email: "nfe-teste@codewave.com.br",
      street: "RUA DE TESTE",
      number: "123",
      district: "BAIRRO TESTE",
      city: "BELO HORIZONTE",
      cityCode: "3106200", // BH/MG → interestadual, CFOP 6101 válido
      state: "MG",
      zipCode: "30130010",
    },
    items: [
      {
        code: "EBOOK-001",
        description: "LIVRO DIGITAL - TESTE DE INTEGRACAO NFSE",
        ncm: "49019900",
        cfop: "6101", // produção própria interestadual (CodeWave é editora/autora)
        unit: "UN",
        quantity: 1,
        unitPrice: 1.00,
        totalPrice: 1.00,
      },
    ],
    serie: nfSerie,
    nNumber: nfNumero,
    infAdic:
      "NF-e emitida para teste de integração WebService MendesERP. " +
      "Documento emitido por ME/EPP optante pelo Simples Nacional. " +
      "Livro digital - imunidade constitucional art. 150, VI, d, CF/88 (STF RE 330817).",
  };

  try {
    console.log("📡  Enviando NF-e para SEFAZ-SP...");
    const result = await provider.emitNFe(input);

    console.log("");
    console.log("✅  NF-e AUTORIZADA!");
    console.log(`   Chave: ${result.chave}`);
    console.log(`   Protocolo: ${result.protocolo}`);
    console.log(`   Número: ${result.numero}`);
  } catch (err) {
    console.error("");
    console.error("❌  Erro na emissão:");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
