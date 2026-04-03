/**
 * Tests for AI configuration actions — validates error handling patterns
 * and consistency between _testAiConnection and _testAiKeyDirect.
 * 
 * Focus: HTTP status codes (400, 403, 404, 422, 429, 5xx) and unified error messages.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  testAiConnection,
  testAiKeyDirect,
} from "../actions";
import { chatCompletion } from "@/lib/ai/provider";
import { resolveAiConfig } from "@/lib/ai/resolve-config";
import { requireAdmin } from "@/lib/session";
import { requireCompanyAccess } from "@/lib/rbac";
import * as encryptionLib from "@/lib/encryption";

// Mock dependencies
vi.mock("@/lib/ai/provider");
vi.mock("@/lib/ai/resolve-config");
vi.mock("@/lib/session");
vi.mock("@/lib/rbac");
vi.mock("@/lib/encryption");
vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
  truncateForLog: vi.fn((arg) => arg),
}));
vi.mock("@/lib/rate-limiter", () => ({
  createAsyncRateLimiter: () => ({
    check: vi.fn().mockResolvedValue({ allowed: true }),
  }),
}));

describe("AI Configuration Actions - Error Handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAdmin as any).mockResolvedValue({ userId: "test-user" });
    (requireCompanyAccess as any).mockResolvedValue(undefined);
    (encryptionLib.decrypt as any).mockImplementation((key) => key);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // BLOCK #1: Consistent 422 error message across both functions
  // =========================================================================

  describe("BLOCK #1: Consistent 422 (Unprocessable Entity) messages", () => {
    it("[testAiConnection] should return consistent 422 message", async () => {
      const mockConfig = {
        apiKey: "encrypted-key-123",
        provider: "openai",
        model: "gpt-4",
      };

      (resolveAiConfig as any).mockResolvedValue(mockConfig);
      (chatCompletion as any).mockRejectedValue(
        new Error("422 Unprocessable Entity: Invalid request body"),
      );

      const result = await testAiConnection("company-1");

      expect(result.ok).toBe(false);
      expect(result.error).toContain(
        "Dados inválidos enviados ao provider — verifique as configurações e o modelo selecionado"
      );
    });

    it("[testAiKeyDirect] should return SAME 422 message as testAiConnection", async () => {
      (chatCompletion as any).mockRejectedValue(
        new Error("422 Unprocessable Entity: Invalid request body"),
      );

      const result = await testAiKeyDirect("company-1", "openai", "test-api-key-12345");

      expect(result.ok).toBe(false);
      // Should match the testAiConnection message exactly
      expect(result.error).toContain(
        "Dados inválidos enviados ao provider — verifique as configurações e o modelo selecionado"
      );
    });

    it("should handle 'unprocessable' variants", async () => {
      const variants = [
        "422 Unprocessable",
        "Unprocessable Entity",
        "Error code 422",
      ];

      for (const variant of variants) {
        const mockConfig = {
          apiKey: "encrypted-key-123",
          provider: "openai",
          model: "gpt-4",
        };

        (resolveAiConfig as any).mockResolvedValue(mockConfig);
        (chatCompletion as any).mockRejectedValue(new Error(variant));

        const result = await testAiConnection("company-1");
        expect(result.error).toContain(
          "Dados inválidos enviados ao provider — verifique as configurações e o modelo selecionado"
        );
      }
    });
  });

  // =========================================================================
  // BLOCK #2: Provider validation delegated to chatCompletion
  // =========================================================================

  describe("BLOCK #2: Provider validation (no early validation)", () => {
    it("[testAiConnection] should NOT validate provider early — delegation to chatCompletion", async () => {
      const mockConfig = {
        apiKey: "encrypted-key-123",
        provider: "invalid-provider", // Invalid, but let chatCompletion handle it
        model: "some-model",
      };

      (resolveAiConfig as any).mockResolvedValue(mockConfig);
      (chatCompletion as any).mockRejectedValue(
        new Error("Provedor AI nao suportado"),
      );

      const result = await testAiConnection("company-1");

      expect(result.ok).toBe(false);
      // Should map the provider error from chatCompletion, not fail early
      expect(result.error).toContain("Provider não suportado");
    });

    it("[testAiKeyDirect] should validate provider frontend-only (basic check)", async () => {
      const result = await testAiKeyDirect(
        "company-1",
        "invalid-provider",
        "test-api-key-12345"
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Provider inválido.");
    });

    it("should map 'not supported' errors consistently", async () => {
      const mockConfig = {
        apiKey: "encrypted-key-123",
        provider: "openai",
        model: "gpt-4",
      };

      (resolveAiConfig as any).mockResolvedValue(mockConfig);
      (chatCompletion as any).mockRejectedValue(
        new Error("Provider 'xyz' not supported"),
      );

      const result = await testAiConnection("company-1");

      expect(result.error).toContain("Provider não suportado");
    });
  });

  // =========================================================================
  // HTTP Status Codes: 400, 403, 404, 429, 5xx, timeout
  // =========================================================================

  describe("HTTP Status Code Error Mapping", () => {
    const testCases = [
      {
        code: "400",
        errors: [
          "400 Bad Request",
          "Bad request",
          "400: Invalid syntax",
        ],
        expectedMessage: "Requisição inválida — verifique o modelo e o provider",
      },
      {
        code: "403",
        errors: [
          "403 Forbidden",
          "Forbidden",
          "403 Access denied",
        ],
        expectedMessage: "Acesso negado pelo provider",
      },
      {
        code: "404",
        errors: [
          "404 Not Found",
          "not found",
          "404 endpoint not found",
        ],
        expectedMessage: "Endpoint não encontrado",
      },
      {
        code: "401",
        errors: [
          "401 Unauthorized",
          "Incorrect API key provided",
          "Invalid token",
        ],
        expectedMessage: "API key inválida ou sem permissão",
      },
      {
        code: "429",
        errors: [
          "429 Too Many Requests",
          "Rate limit exceeded",
          "Quota exceeded",
        ],
        expectedMessage: "Limite de requisições atingido",
      },
      {
        code: "5xx",
        errors: [
          "500 Internal Server Error",
          "502 Bad Gateway",
          "503 Service Unavailable",
          "Server error",
        ],
        expectedMessage: "Erro interno no servidor do provider",
      },
      {
        code: "timeout",
        errors: [
          "timeout",
          "ETIMEDOUT",
          "timed out",
        ],
        expectedMessage: "Timeout ao conectar ao provider",
      },
    ];

    for (const { code, errors, expectedMessage } of testCases) {
      describe(`HTTP ${code}`, () => {
        for (const errorMsg of errors) {
          it(`_testAiConnection: should map "${errorMsg}"`, async () => {
            const mockConfig = {
              apiKey: "encrypted-key-123",
              provider: "openai",
              model: "gpt-4",
            };

            (resolveAiConfig as any).mockResolvedValue(mockConfig);
            (chatCompletion as any).mockRejectedValue(new Error(errorMsg));

            const result = await testAiConnection("company-1");

            expect(result.ok).toBe(false);
            expect(result.error).toContain(expectedMessage);
          });

          it(`_testAiKeyDirect: should map "${errorMsg}" (consistent)`, async () => {
            (chatCompletion as any).mockRejectedValue(new Error(errorMsg));

            const result = await testAiKeyDirect(
              "company-1",
              "openai",
              "test-api-key-12345"
            );

            expect(result.ok).toBe(false);
            expect(result.error).toContain(expectedMessage);
          });
        }
      });
    }
  });

  // =========================================================================
  // DRY & Code Coverage
  // =========================================================================

  describe("Code Quality - DRY (No Duplication)", () => {
    it("both functions should use unified mapProviderErrorToMessage", async () => {
      // This test validates that the error-to-message mapping is unified,
      // not duplicated across functions. Implementation detail: if both
      // functions produce the same output for the same error, they're
      // using the same mapping logic.

      const testError = "403 Forbidden: insufficient permissions";

      // Mock for testAiConnection
      const mockConfig = {
        apiKey: "encrypted-key-123",
        provider: "openai",
        model: "gpt-4",
      };

      (resolveAiConfig as any).mockResolvedValue(mockConfig);
      (chatCompletion as any).mockRejectedValue(new Error(testError));

      const result1 = await testAiConnection("company-1");

      // Mock for testAiKeyDirect
      (chatCompletion as any).mockRejectedValue(new Error(testError));
      const result2 = await testAiKeyDirect(
        "company-1",
        "openai",
        "test-api-key-12345"
      );

      // Both should produce identical error messages
      expect(result1.error).toBe(result2.error);
      expect(result1.error).toContain("Acesso negado pelo provider");
    });
  });

  // =========================================================================
  // Happy Path
  // =========================================================================

  describe("Happy Path - Successful Tests", () => {
    it("[testAiConnection] should return ok=true on success", async () => {
      const mockConfig = {
        apiKey: "encrypted-key-123",
        provider: "openai",
        model: "gpt-4",
      };

      (resolveAiConfig as any).mockResolvedValue(mockConfig);
      (chatCompletion as any).mockResolvedValue({
        message: "success",
        usage: { input_tokens: 5, output_tokens: 10 },
      });

      const result = await testAiConnection("company-1");

      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("[testAiKeyDirect] should return ok=true on success", async () => {
      (chatCompletion as any).mockResolvedValue({
        message: "success",
        usage: { input_tokens: 5, output_tokens: 10 },
      });

      const result = await testAiKeyDirect(
        "company-1",
        "openai",
        "test-api-key-12345"
      );

      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================

  describe("Edge Cases", () => {
    it("[testAiConnection] should handle missing API key config", async () => {
      (resolveAiConfig as any).mockResolvedValue(null);

      const result = await testAiConnection("company-1");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("API key não configurada");
    });

    it("[testAiKeyDirect] should reject short API keys", async () => {
      const result = await testAiKeyDirect("company-1", "openai", "short");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("API key muito curta.");
    });

    it("[testAiConnection] should handle decryption errors gracefully", async () => {
      const mockConfig = {
        apiKey: "encrypted-key-123",
        provider: "openai",
        model: "gpt-4",
      };

      (resolveAiConfig as any).mockResolvedValue(mockConfig);
      (encryptionLib.decrypt as any).mockImplementation(() => {
        throw new Error("Decryption failed");
      });

      const result = await testAiConnection("company-1");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Falha ao descriptografar a API key");
    });

    it("should handle unknown/fallback errors", async () => {
      const mockConfig = {
        apiKey: "encrypted-key-123",
        provider: "openai",
        model: "gpt-4",
      };

      (resolveAiConfig as any).mockResolvedValue(mockConfig);
      (chatCompletion as any).mockRejectedValue(
        new Error("Some completely unknown error")
      );

      const result = await testAiConnection("company-1");

      expect(result.ok).toBe(false);
      expect(result.error).toContain(
        "Erro ao testar conexão com o provider. Verifique as configurações."
      );
    });
  });
});
