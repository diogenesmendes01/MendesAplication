import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";


vi.mock("@/lib/auth", () => ({
  verifyAccessToken: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/trace-context", () => ({
  traceStore: {
    run: vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
    getStore: vi.fn().mockReturnValue(null),
  },
}));
// ---------------------------------------------------------------------------
// Mocks — must be declared before any import that uses them
// ---------------------------------------------------------------------------

// Mock @prisma/client enums
vi.mock("@prisma/client", () => ({
  BoletoStatus: {
    PENDING: "PENDING",
    PAID: "PAID",
    CANCELLED: "CANCELLED",
    OVERDUE: "OVERDUE",
  },
  PaymentStatus: {
    PENDING: "PENDING",
    PAID: "PAID",
  },
}));

// Mock prisma
const mockTx = {
  $queryRaw: vi.fn(),
  boleto: { update: vi.fn() },
  accountReceivable: { findFirst: vi.fn(), update: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentProvider: { findFirst: vi.fn(), findMany: vi.fn() },
    boleto: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
  },
}));

// Mock encryption
vi.mock("@/lib/encryption", () => ({
  decrypt: vi.fn((val: string) => val),
}));

// Mock factory
vi.mock("@/lib/payment/factory", () => ({
  getGateway: vi.fn(),
}));

// Mock audit
vi.mock("@/lib/audit", () => ({
  logAuditEvent: vi.fn(async () => {}),
}));

// Mock logger
vi.mock("@/lib/logger", () => {
  const _log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
  return {
    logger: _log,
    createChildLogger: vi.fn(() => _log),
    sanitizeParams: vi.fn((obj: Record<string, unknown>) => obj),
    truncateForLog: vi.fn((v: unknown) => v),
    classifyError: vi.fn(() => "INTERNAL_ERROR"),
    classifyErrorByStatus: vi.fn(() => "INTERNAL_ERROR"),
    ErrorCode: {
      AUTH_FAILED: "AUTH_FAILED",
      VALIDATION_ERROR: "VALIDATION_ERROR",
      NOT_FOUND: "NOT_FOUND",
      PERMISSION_DENIED: "PERMISSION_DENIED",
      EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",
      DATABASE_ERROR: "DATABASE_ERROR",
      ENCRYPTION_ERROR: "ENCRYPTION_ERROR",
      RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
      INTERNAL_ERROR: "INTERNAL_ERROR",
      AUTH_TOKEN_EXPIRED: "AUTH_TOKEN_EXPIRED",
    },
    MAX_LOG_ARG_SIZE: 10240,
  };
});

// Mock next/server
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    NextResponse: {
      json: (body: unknown, init?: { status?: number }) => {
        const status = init?.status ?? 200;
        return {
          status,
          json: async () => body,
        };
      },
    },
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST } from "../route";
import { prisma } from "@/lib/prisma";
import { getGateway } from "@/lib/payment/factory";
import { logAuditEvent } from "@/lib/audit";

const mockedPrisma = vi.mocked(prisma, true);
const mockedGetGateway = vi.mocked(getGateway);
const mockedLogAudit = vi.mocked(logAuditEvent);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: string, headers?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/webhooks/payment/prov-001", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-hub-signature": "sha1=validsig",
      ...headers,
    },
  });
}

function makeProvider(overrides?: Record<string, unknown>) {
  return {
    id: "prov-001",
    name: "Test Provider",
    provider: "pagarme",
    isActive: true,
    isDefault: false,
    companyId: "company-001",
    credentials: '{"apiKey":"sk_test_123"}',
    metadata: null,
    webhookSecret: "encrypted-secret",
    webhookUrl: null,
    sandbox: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeBoleto(overrides?: Record<string, unknown>) {
  return {
    id: "boleto-001",
    gatewayId: "ch_123",
    providerId: "prov-001",
    companyId: "company-001",
    status: "PENDING",
    value: 100.0,
    dueDate: new Date("2026-04-01"),
    proposal: {
      id: "prop-001",
      clientId: "client-001",
      companyId: "company-001",
    },
    ...overrides,
  };
}

function makeMockGateway(overrides?: Record<string, unknown>) {
  return {
    validateWebhook: vi.fn(() => true),
    parseWebhookEvent: vi.fn(() => ({
      type: "boleto.paid" as const,
      gatewayId: "ch_123",
      paidAt: new Date("2026-03-20T10:00:00Z"),
      paidAmount: 10000,
      rawEvent: { _isOverpaid: false },
    })),
    createBoleto: vi.fn(),
    getBoletoStatus: vi.fn(),
    cancelBoleto: vi.fn(),
    testConnection: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/webhooks/payment/[provider]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the $transaction mock for each test
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockedPrisma.$transaction as any).mockImplementation(
      async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    );
  });

  it("retorna 200 com no_providers quando provider não encontrado", async () => {
    mockedPrisma.paymentProvider.findFirst.mockResolvedValue(null);
    mockedPrisma.paymentProvider.findMany.mockResolvedValue([]);

    const req = makeRequest('{"type":"charge.paid"}');
    const res = await POST(req, { params: Promise.resolve({ provider: "unknown-id" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.error).toBe("no_providers");
  });

  it("retorna 401 quando signature inválida", async () => {
    const provider = makeProvider();
    mockedPrisma.paymentProvider.findFirst.mockResolvedValue(provider as never);

    const gateway = makeMockGateway({
      validateWebhook: vi.fn(() => false),
    });
    mockedGetGateway.mockReturnValue(gateway as never);

    const req = makeRequest('{"type":"charge.paid"}');
    const res = await POST(req, { params: Promise.resolve({ provider: "prov-001" }) });
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe("invalid_signature");
  });

  it("retorna 200 com skipped para event type desconhecido (parseWebhookEvent retorna null)", async () => {
    const provider = makeProvider();
    mockedPrisma.paymentProvider.findFirst.mockResolvedValue(provider as never);

    const gateway = makeMockGateway({
      parseWebhookEvent: vi.fn(() => null),
    });
    mockedGetGateway.mockReturnValue(gateway as never);

    const req = makeRequest('{"type":"charge.created"}');
    const res = await POST(req, { params: Promise.resolve({ provider: "prov-001" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.skipped).toBe("unknown_event_type");
  });

  it("retorna 200 com not_found quando boleto não existe", async () => {
    const provider = makeProvider();
    mockedPrisma.paymentProvider.findFirst.mockResolvedValue(provider as never);
    mockedPrisma.boleto.findFirst.mockResolvedValue(null);

    const gateway = makeMockGateway();
    mockedGetGateway.mockReturnValue(gateway as never);

    const req = makeRequest('{"type":"charge.paid"}');
    const res = await POST(req, { params: Promise.resolve({ provider: "prov-001" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.boleto).toBe("not_found");
    expect(mockedLogAudit).toHaveBeenCalled();
  });

  it("fluxo completo paid: atualiza boleto e receivable", async () => {
    const provider = makeProvider();
    const boleto = makeBoleto();
    const gateway = makeMockGateway();

    mockedPrisma.paymentProvider.findFirst.mockResolvedValue(provider as never);
    mockedGetGateway.mockReturnValue(gateway as never);
    mockedPrisma.boleto.findFirst.mockResolvedValue(boleto as never);

    mockTx.$queryRaw.mockResolvedValue([
      { id: "boleto-001", status: "PENDING", value: "100.00" },
    ]);
    mockTx.boleto.update.mockResolvedValue({});

    const receivable = {
      id: "ar-001",
      boletoId: "boleto-001",
      companyId: "company-001",
      status: "PENDING",
    };
    mockTx.accountReceivable.findFirst.mockResolvedValue(receivable);
    mockTx.accountReceivable.update.mockResolvedValue({});

    const req = makeRequest('{"type":"charge.paid"}');
    const res = await POST(req, { params: Promise.resolve({ provider: "prov-001" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.received).toBe(true);
    expect(mockTx.boleto.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "boleto-001" },
        data: { status: "PAID" },
      }),
    );
  });

  it("idempotência: skip quando já no status target", async () => {
    const provider = makeProvider();
    const boleto = makeBoleto({ status: "PAID" });
    const gateway = makeMockGateway();

    mockedPrisma.paymentProvider.findFirst.mockResolvedValue(provider as never);
    mockedGetGateway.mockReturnValue(gateway as never);
    mockedPrisma.boleto.findFirst.mockResolvedValue(boleto as never);

    mockTx.$queryRaw.mockResolvedValue([
      { id: "boleto-001", status: "PAID", value: "100.00" },
    ]);

    const req = makeRequest('{"type":"charge.paid"}');
    const res = await POST(req, { params: Promise.resolve({ provider: "prov-001" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.skipped).toBe("already_in_status");
  });

  it("overpaid: gera audit event com flag OVERPAID", async () => {
    const provider = makeProvider();
    const boleto = makeBoleto();
    const gateway = makeMockGateway({
      parseWebhookEvent: vi.fn(() => ({
        type: "boleto.paid" as const,
        gatewayId: "ch_123",
        paidAt: new Date("2026-03-20T10:00:00Z"),
        paidAmount: 15000,
        rawEvent: { _isOverpaid: true },
      })),
    });

    mockedPrisma.paymentProvider.findFirst.mockResolvedValue(provider as never);
    mockedGetGateway.mockReturnValue(gateway as never);
    mockedPrisma.boleto.findFirst.mockResolvedValue(boleto as never);

    mockTx.$queryRaw.mockResolvedValue([
      { id: "boleto-001", status: "PENDING", value: "100.00" },
    ]);
    mockTx.boleto.update.mockResolvedValue({});
    mockTx.accountReceivable.findFirst.mockResolvedValue(null);

    const req = makeRequest('{"type":"charge.overpaid"}');
    const res = await POST(req, { params: Promise.resolve({ provider: "prov-001" }) });

    expect(res.status).toBe(200);
    const auditCalls = mockedLogAudit.mock.calls;
    const overpaidCall = auditCalls.find(
      (call) => {
        const arg = call[0] as unknown as Record<string, Record<string, unknown>>;
        return arg.dataAfter && arg.dataAfter.alert === "OVERPAID";
      },
    );
    expect(overpaidCall).toBeDefined();
  });

  it("busca por provider ID primeiro, fallback para type", async () => {
    const provider = makeProvider({ id: "specific-id" });
    mockedPrisma.paymentProvider.findFirst.mockResolvedValue(provider as never);

    const gateway = makeMockGateway({
      parseWebhookEvent: vi.fn(() => null),
    });
    mockedGetGateway.mockReturnValue(gateway as never);

    const req = makeRequest('{"type":"charge.created"}');
    await POST(req, { params: Promise.resolve({ provider: "specific-id" }) });

    expect(mockedPrisma.paymentProvider.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "specific-id" }),
      }),
    );
  });
});
