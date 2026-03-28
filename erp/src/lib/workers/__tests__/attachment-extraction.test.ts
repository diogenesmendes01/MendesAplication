/**
 * Unit tests for attachment-extraction worker.
 * Tests the cascade extraction pipeline: pdf-parse → OCR → Vision.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";

const mockPrismaUpsert = vi.fn().mockResolvedValue({ id: "ext-1" });
const mockPrismaUpdate = vi.fn().mockResolvedValue({ id: "ext-1" });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    attachmentExtraction: {
      upsert: (...args: unknown[]) => mockPrismaUpsert(...args),
      update: (...args: unknown[]) => mockPrismaUpdate(...args),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockReadFile = vi.fn();
vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

const mockPdfParse = vi.fn();
vi.mock("pdf-parse", () => ({
  default: (...args: unknown[]) => mockPdfParse(...args),
}));

const mockRecognize = vi.fn();
vi.mock("tesseract.js", () => ({
  recognize: (...args: unknown[]) => mockRecognize(...args),
}));

const mockExtractRawText = vi.fn();
vi.mock("mammoth", () => ({
  extractRawText: (...args: unknown[]) => mockExtractRawText(...args),
}));

const mockXlsxRead = vi.fn();
const mockSheetToCsv = vi.fn();
vi.mock("xlsx", () => ({
  read: (...args: unknown[]) => mockXlsxRead(...args),
  utils: { sheet_to_csv: (...args: unknown[]) => mockSheetToCsv(...args) },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  processAttachmentExtraction,
  isExtractionUsable,
  estimateTokens,
} from "../attachment-extraction";
import type { ExtractionJobData } from "../attachment-extraction";

function makeJob(overrides: Partial<ExtractionJobData> = {}): Job<ExtractionJobData> {
  return {
    data: {
      attachmentId: "att-123",
      storagePath: "company1/2026-03/file.pdf",
      mimeType: "application/pdf",
      fileName: "boleto.pdf",
      companyId: "company-1",
      ...overrides,
    },
  } as Job<ExtractionJobData>;
}

function mockSummaryResponse(summary: string, metadata: Record<string, unknown> = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ summary, metadata }) } }],
    }),
  });
}

describe("attachment-extraction worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    mockReadFile.mockResolvedValue(Buffer.from("test content"));
  });

  describe("isExtractionUsable", () => {
    it("returns false for empty string", () => { expect(isExtractionUsable("")).toBe(false); });
    it("returns false for very short text", () => { expect(isExtractionUsable("abc")).toBe(false); });
    it("returns false for short text without real words", () => { expect(isExtractionUsable(".. -- .. --")).toBe(false); });
    it("returns true for usable text", () => {
      expect(isExtractionUsable("Este é um texto válido com conteúdo suficiente para análise")).toBe(true);
    });
    it("returns false for null/undefined", () => {
      expect(isExtractionUsable(null)).toBe(false);
      expect(isExtractionUsable(undefined)).toBe(false);
    });
  });

  describe("estimateTokens", () => {
    it("estimates roughly 1 token per 4 chars", () => {
      expect(estimateTokens("abcdefgh")).toBe(2);
      expect(estimateTokens("a".repeat(100))).toBe(25);
    });
  });

  describe("processAttachmentExtraction", () => {
    it("marks unsupported mime types as failed", async () => {
      await processAttachmentExtraction(makeJob({ mimeType: "application/zip" }));
      expect(mockPrismaUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { attachmentId: "att-123" },
        data: expect.objectContaining({ status: "failed", errorMessage: expect.stringContaining("não suportado") }),
      }));
    });

    it("marks empty files as failed", async () => {
      mockReadFile.mockResolvedValue(Buffer.alloc(0));
      await processAttachmentExtraction(makeJob());
      expect(mockPrismaUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { attachmentId: "att-123" },
        data: expect.objectContaining({ status: "failed", errorMessage: expect.stringContaining("vazio") }),
      }));
    });

    it("extracts text from PDF using pdf-parse", async () => {
      const pdfText = "Boleto Bancário - Valor: R$ 1.500,00 - CNPJ: 12.345.678/0001-90 - Vencimento 15/04/2026";
      mockPdfParse.mockResolvedValue({ text: pdfText });
      mockSummaryResponse("Boleto bancário", { cnpjs: ["12345678000190"] });
      await processAttachmentExtraction(makeJob());
      expect(mockPrismaUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { attachmentId: "att-123" },
        data: expect.objectContaining({ status: "completed", method: "pdf-parse", rawText: pdfText, confidence: 0.95 }),
      }));
    });

    it("falls back to OCR when pdf-parse returns empty text", async () => {
      mockPdfParse.mockResolvedValue({ text: "" });
      mockRecognize.mockResolvedValue({ data: { text: "Texto extraído via OCR com conteúdo suficiente para ser válido" } });
      mockSummaryResponse("Documento extraído por OCR", {});
      await processAttachmentExtraction(makeJob());
      expect(mockPrismaUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { attachmentId: "att-123" },
        data: expect.objectContaining({ status: "completed", method: "ocr", confidence: 0.7 }),
      }));
    });

    it("falls back to Vision when OCR fails", async () => {
      mockPdfParse.mockResolvedValue({ text: "" });
      mockRecognize.mockRejectedValue(new Error("OCR failed"));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "Texto extraído pela Vision API do documento escaneado" } }] }),
      });
      mockSummaryResponse("Documento extraído por visão", {});
      await processAttachmentExtraction(makeJob());
      expect(mockPrismaUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { attachmentId: "att-123" },
        data: expect.objectContaining({ status: "completed", method: "vision", confidence: 0.85 }),
      }));
    });

    it("extracts text from plain text files directly", async () => {
      const text = "Este é um arquivo de texto puro com conteúdo suficiente";
      mockReadFile.mockResolvedValue(Buffer.from(text));
      mockSummaryResponse("Arquivo de texto simples", {});
      await processAttachmentExtraction(makeJob({ mimeType: "text/plain", fileName: "notas.txt" }));
      expect(mockPrismaUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { attachmentId: "att-123" },
        data: expect.objectContaining({ status: "completed", method: "direct", rawText: text, confidence: 0.95 }),
      }));
    });

    it("extracts text from CSV files", async () => {
      mockReadFile.mockResolvedValue(Buffer.from("Nome,Valor,Data\nEmpresa ABC,1500.00,2026-04-15\nEmpresa XYZ,2300.50,2026-05-01"));
      mockSummaryResponse("Planilha CSV", {});
      await processAttachmentExtraction(makeJob({ mimeType: "text/csv", fileName: "dados.csv" }));
      expect(mockPrismaUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { attachmentId: "att-123" },
        data: expect.objectContaining({ status: "completed", method: "direct", confidence: 0.95 }),
      }));
    });

    it("extracts text from XLSX spreadsheets", async () => {
      mockXlsxRead.mockReturnValue({ SheetNames: ["Sheet1"], Sheets: { Sheet1: {} } });
      mockSheetToCsv.mockReturnValue("Nome,Valor\nEmpresa ABC,1500.00\nEmpresa XYZ,2300.50");
      mockSummaryResponse("Planilha com dados", {});
      await processAttachmentExtraction(makeJob({
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileName: "relatorio.xlsx",
      }));
      expect(mockPrismaUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { attachmentId: "att-123" },
        data: expect.objectContaining({ status: "completed", method: "spreadsheet", confidence: 0.9 }),
      }));
    });

    it("extracts text from DOCX documents", async () => {
      mockExtractRawText.mockResolvedValue({ value: "Contrato de prestação de serviços entre Empresa ABC e Empresa XYZ" });
      mockSummaryResponse("Contrato de prestação de serviços", { documentType: "contrato" });
      await processAttachmentExtraction(makeJob({
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileName: "contrato.docx",
      }));
      expect(mockPrismaUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { attachmentId: "att-123" },
        data: expect.objectContaining({ status: "completed", method: "direct", confidence: 0.95 }),
      }));
    });

    it("processes images with OCR", async () => {
      mockRecognize.mockResolvedValue({ data: { text: "CNPJ: 12.345.678/0001-90 - Comprovante de pagamento no valor de R$ 500,00" } });
      mockSummaryResponse("Comprovante de pagamento", { cnpjs: ["12345678000190"] });
      await processAttachmentExtraction(makeJob({ mimeType: "image/jpeg", fileName: "comprovante.jpg" }));
      expect(mockPrismaUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { attachmentId: "att-123" },
        data: expect.objectContaining({ status: "completed", method: "ocr", confidence: 0.7 }),
      }));
    });

    it("marks as failed when all extraction methods fail", async () => {
      mockPdfParse.mockRejectedValue(new Error("parse error"));
      mockRecognize.mockRejectedValue(new Error("ocr error"));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "" } }] }),
      });
      await processAttachmentExtraction(makeJob());
      expect(mockPrismaUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { attachmentId: "att-123" },
        data: expect.objectContaining({ status: "failed", errorMessage: expect.stringContaining("Nenhum método") }),
      }));
    });

    it("saves rawText without truncation", async () => {
      const longText = "A".repeat(50000) + " important data at the end";
      mockPdfParse.mockResolvedValue({ text: longText });
      mockSummaryResponse("Documento muito longo", {});
      await processAttachmentExtraction(makeJob());
      expect(mockPrismaUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { attachmentId: "att-123" },
        data: expect.objectContaining({ status: "completed", rawText: longText }),
      }));
    });

    it("handles summary generation failure gracefully", async () => {
      const pdfText = "Boleto Bancário com CNPJ: 12.345.678/0001-90 no valor de R$ 1.500,00";
      mockPdfParse.mockResolvedValue({ text: pdfText });
      mockFetch.mockRejectedValueOnce(new Error("API error"));
      await processAttachmentExtraction(makeJob());
      expect(mockPrismaUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { attachmentId: "att-123" },
        data: expect.objectContaining({
          status: "completed", method: "pdf-parse", rawText: pdfText,
          summary: expect.stringContaining("boleto.pdf"),
          metadata: expect.objectContaining({ cnpjs: ["12345678000190"] }),
        }),
      }));
    });

    it("logs CNPJs found in metadata", async () => {
      mockPdfParse.mockResolvedValue({ text: "Documento com CNPJ 12.345.678/0001-90 identificado corretamente" });
      mockSummaryResponse("Documento com CNPJ", { cnpjs: ["12345678000190"] });
      await processAttachmentExtraction(makeJob());
      const { logger } = await import("@/lib/logger");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ attachmentId: "att-123", cnpjs: ["12345678000190"] }),
        expect.stringContaining("CNPJ")
      );
    });

    it("handles file read errors", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT: file not found"));
      await processAttachmentExtraction(makeJob());
      expect(mockPrismaUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { attachmentId: "att-123" },
        data: expect.objectContaining({ status: "failed", errorMessage: expect.stringContaining("ENOENT") }),
      }));
    });
  });
});
