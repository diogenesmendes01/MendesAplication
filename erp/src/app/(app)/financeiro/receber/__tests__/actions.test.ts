import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRequireCompanyAccess = vi.fn();
const mockLogAuditEvent = vi.fn();
const mockGetSharedCompanyIds = vi.fn();

vi.mock("@/lib/rbac", () => ({
  requireCompanyAccess: (...args: unknown[]) => mockRequireCompanyAccess(...args),
}));

vi.mock("@/lib/audit", () => ({
  logAuditEvent: (...args: unknown[]) => mockLogAuditEvent(...args),
}));

vi.mock("@/lib/shared-clients", () => ({
  getSharedCompanyIds: (...args: unknown[]) => mockGetSharedCompanyIds(...args),
}));

// Mock @prisma/client to avoid loading the real Prisma runtime in unit tests.
// Prisma.Decimal is used inside createReceivable — we provide a complete stub
// covering arithmetic operations (add, mul, div, sub) and comparisons so that
// any future action using Decimal arithmetic is not silently masked.
vi.mock("@prisma/client", async () => {
  class DecimalStub {
    private val: number;
    constructor(v: number | string) {
      this.val = Number(v);
    }
    toString() {
      return String(this.val);
    }
    toNumber() {
      return this.val;
    }
    toFixed(decimals?: number) {
      return this.val.toFixed(decimals);
    }
    add(other: DecimalStub | number | string) {
      return new DecimalStub(this.val + Number(other instanceof DecimalStub ? other.toNumber() : other));
    }
    sub(other: DecimalStub | number | string) {
      return new DecimalStub(this.val - Number(other instanceof DecimalStub ? other.toNumber() : other));
    }
    mul(other: DecimalStub | number | string) {
      return new DecimalStub(this.val * Number(other instanceof DecimalStub ? other.toNumber() : other));
    }
    div(other: DecimalStub | number | string) {
      return new DecimalStub(this.val / Number(other instanceof DecimalStub ? other.toNumber() : other));
    }
    equals(other: DecimalStub | number | string) {
      return this.val === Number(other instanceof DecimalStub ? other.toNumber() : other);
    }
    greaterThan(other: DecimalStub | number | string) {
      return this.val > Number(other instanceof DecimalStub ? other.toNumber() : other);
    }
    lessThan(other: DecimalStub | number | string) {
      return this.val < Number(other instanceof DecimalStub ? other.toNumber() : other);
    }
  }
  return {
    Prisma: { Decimal: DecimalStub },
    // Expose commonly referenced enums/types as needed
  };
});

const mockFindMany = vi.fn();
const mockCount = vi.fn();
const mockCreate = vi.fn();
const mockFindFirst = vi.fn();
const mockUpdate = vi.fn();
const mockClientFindFirst = vi.fn();
const mockClientFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    accountReceivable: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      count: (...args: unknown[]) => mockCount(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    client: {
      findFirst: (...args: unknown[]) => mockClientFindFirst(...args),
      findMany: (...args: unknown[]) => mockClientFindMany(...args),
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION = { userId: "user-1", role: "MANAGER" };
const COMPANY_ID = "company-abc";

/** Returns a fake AccountReceivable row as Prisma would (value has .toString). */
function makeReceivableRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    description: "Serviço de consultoria",
    // Simulate Prisma Decimal: plain object with toString()
    value: { toString: () => "1500.00" },
    dueDate: new Date("2024-06-15T00:00:00.000Z"),
    status: "PENDING",
    paidAt: null,
    createdAt: new Date("2024-06-01T00:00:00.000Z"),
    client: { id: "client-1", name: "Empresa X" },
    boleto: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: listReceivables
// ---------------------------------------------------------------------------

describe("listReceivables", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRequireCompanyAccess.mockResolvedValue(SESSION);
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
  });

  it("should call requireCompanyAccess with the correct companyId", async () => {
    const { listReceivables } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await listReceivables({ companyId: COMPANY_ID });
    expect(mockRequireCompanyAccess).toHaveBeenCalledWith(COMPANY_ID);
  });

  it("should return paginated result with defaults (page=1, pageSize=10)", async () => {
    const row = makeReceivableRow();
    mockFindMany.mockResolvedValue([row]);
    mockCount.mockResolvedValue(1);

    const { listReceivables } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    const result = await listReceivables({ companyId: COMPANY_ID });

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("rec-1");
    expect(result.data[0].value).toBe("1500.00");
  });

  it("should clamp page 0 to page 1", async () => {
    const { listReceivables } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    const result = await listReceivables({ companyId: COMPANY_ID, page: 0 });
    expect(result.page).toBe(1);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 })
    );
  });

  it("should clamp pageSize > 100 to 100", async () => {
    const { listReceivables } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    const result = await listReceivables({
      companyId: COMPANY_ID,
      pageSize: 999,
    });
    expect(result.pageSize).toBe(100);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 })
    );
  });

  it("should filter by status when provided", async () => {
    const { listReceivables } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await listReceivables({ companyId: COMPANY_ID, status: "PAID" });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PAID" }),
      })
    );
  });

  it("should filter by clientId when provided", async () => {
    const { listReceivables } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await listReceivables({ companyId: COMPANY_ID, clientId: "client-99" });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clientId: "client-99" }),
      })
    );
  });

  it("should filter by dateFrom and dateTo", async () => {
    const { listReceivables } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await listReceivables({
      companyId: COMPANY_ID,
      dateFrom: "2024-01-01",
      dateTo: "2024-01-31",
    });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dueDate: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
      })
    );
  });

  it("should return providerName as null when boleto is null", async () => {
    const row = makeReceivableRow({ boleto: null });
    mockFindMany.mockResolvedValue([row]);
    mockCount.mockResolvedValue(1);

    const { listReceivables } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    const result = await listReceivables({ companyId: COMPANY_ID });

    expect(result.data[0].providerName).toBeNull();
    expect(result.data[0].manualOverride).toBe(false);
  });

  it("should return providerName populated when boleto exists", async () => {
    const row = makeReceivableRow({
      boleto: {
        provider: { name: "Itaú" },
        manualOverride: true,
      },
    });
    mockFindMany.mockResolvedValue([row]);
    mockCount.mockResolvedValue(1);

    const { listReceivables } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    const result = await listReceivables({ companyId: COMPANY_ID });

    expect(result.data[0].providerName).toBe("Itaú");
    expect(result.data[0].manualOverride).toBe(true);
  });

  it("should throw when requireCompanyAccess rejects (RBAC)", async () => {
    mockRequireCompanyAccess.mockRejectedValue(
      new Error("Acesso negado. Você não tem permissão para acessar esta empresa.")
    );
    const { listReceivables } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(
      listReceivables({ companyId: "foreign-company" })
    ).rejects.toThrow("Acesso negado");
  });

  it("should propagate Prisma errors from findMany (DB failure)", async () => {
    mockFindMany.mockRejectedValue(new Error("Connection timed out"));
    const { listReceivables } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(listReceivables({ companyId: COMPANY_ID })).rejects.toThrow(
      "Connection timed out"
    );
  });

  it("should propagate Prisma errors from count (DB failure)", async () => {
    mockCount.mockRejectedValue(new Error("Database is unavailable"));
    const { listReceivables } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(listReceivables({ companyId: COMPANY_ID })).rejects.toThrow(
      "Database is unavailable"
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: createReceivable
// ---------------------------------------------------------------------------

describe("createReceivable", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRequireCompanyAccess.mockResolvedValue(SESSION);
    mockClientFindFirst.mockResolvedValue({ id: "client-1", name: "Empresa X" });
    mockCreate.mockResolvedValue({
      id: "rec-new",
      clientId: "client-1",
      description: "Consultoria",
      value: { toString: () => "1000.00" },
      dueDate: new Date("2024-07-01"),
    });
    mockLogAuditEvent.mockResolvedValue(undefined);
  });

  const validInput = {
    companyId: COMPANY_ID,
    clientId: "client-1",
    description: "Consultoria",
    value: 1000,
    dueDate: "2024-07-01",
  };

  it("should create a receivable and return its id", async () => {
    const { createReceivable } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    const result = await createReceivable(validInput);
    expect(result).toEqual({ id: "rec-new" });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("should call logAuditEvent after creation", async () => {
    const { createReceivable } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await createReceivable(validInput);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CREATE",
        entity: "AccountReceivable",
        entityId: "rec-new",
        userId: SESSION.userId,
      })
    );
  });

  it("should throw when clientId is empty", async () => {
    const { createReceivable } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(
      createReceivable({ ...validInput, clientId: "  " })
    ).rejects.toThrow("Cliente é obrigatório");
  });

  it("should throw when description is empty", async () => {
    const { createReceivable } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(
      createReceivable({ ...validInput, description: "" })
    ).rejects.toThrow("Descrição é obrigatória");
  });

  it("should throw when value is zero", async () => {
    const { createReceivable } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(
      createReceivable({ ...validInput, value: 0 })
    ).rejects.toThrow("Valor deve ser maior que zero");
  });

  it("should throw when value is negative", async () => {
    const { createReceivable } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(
      createReceivable({ ...validInput, value: -50 })
    ).rejects.toThrow("Valor deve ser maior que zero");
  });

  it("should throw when dueDate is missing", async () => {
    const { createReceivable } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(
      createReceivable({ ...validInput, dueDate: "" })
    ).rejects.toThrow("Data de vencimento é obrigatória");
  });

  it("should throw when client does not belong to the company", async () => {
    mockClientFindFirst.mockResolvedValue(null);
    const { createReceivable } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(createReceivable(validInput)).rejects.toThrow(
      "Cliente não encontrado nesta empresa"
    );
  });

  it("should throw (RBAC) when access is denied", async () => {
    mockRequireCompanyAccess.mockRejectedValue(
      new Error("Acesso negado. Você não tem permissão para acessar esta empresa.")
    );
    const { createReceivable } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(createReceivable(validInput)).rejects.toThrow("Acesso negado");
  });

  it("should propagate Prisma errors from create (DB failure)", async () => {
    mockCreate.mockRejectedValue(
      new Error("Unique constraint failed on the fields: (`id`)")
    );
    const { createReceivable } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(createReceivable(validInput)).rejects.toThrow(
      "Unique constraint failed"
    );
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it("should propagate Prisma errors from client lookup (DB failure)", async () => {
    mockClientFindFirst.mockRejectedValue(new Error("Connection timed out"));
    const { createReceivable } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(createReceivable(validInput)).rejects.toThrow(
      "Connection timed out"
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: markReceivableAsPaid
// ---------------------------------------------------------------------------

describe("markReceivableAsPaid", () => {
  const pendingReceivable = {
    id: "rec-1",
    companyId: COMPANY_ID,
    status: "PENDING",
    paidAt: null,
  };

  const paidReceivable = {
    ...pendingReceivable,
    status: "PAID",
    paidAt: new Date("2024-06-10"),
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRequireCompanyAccess.mockResolvedValue(SESSION);
    mockFindFirst.mockResolvedValue(pendingReceivable);
    mockUpdate.mockResolvedValue({
      ...pendingReceivable,
      status: "PAID",
      paidAt: new Date(),
    });
    mockLogAuditEvent.mockResolvedValue(undefined);
  });

  it("should mark a pending receivable as paid and return success", async () => {
    const { markReceivableAsPaid } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    const result = await markReceivableAsPaid("rec-1", COMPANY_ID);
    expect(result).toEqual({ success: true });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: expect.objectContaining({ status: "PAID" }),
      })
    );
  });

  it("should use provided paidAt date", async () => {
    const customDate = new Date("2024-05-20");
    const { markReceivableAsPaid } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await markReceivableAsPaid("rec-1", COMPANY_ID, customDate);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paidAt: customDate }),
      })
    );
  });

  it("should log an audit event with STATUS_CHANGE action", async () => {
    const { markReceivableAsPaid } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await markReceivableAsPaid("rec-1", COMPANY_ID);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "STATUS_CHANGE",
        entity: "AccountReceivable",
        entityId: "rec-1",
        dataBefore: { status: "PENDING" },
        dataAfter: expect.objectContaining({ status: "PAID" }),
      })
    );
  });

  it("should include notes in audit log when provided", async () => {
    const { markReceivableAsPaid } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await markReceivableAsPaid("rec-1", COMPANY_ID, undefined, "Pago via PIX");
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        dataAfter: expect.objectContaining({ notes: "Pago via PIX" }),
      })
    );
  });

  it("should throw when receivable does not exist", async () => {
    mockFindFirst.mockResolvedValue(null);
    const { markReceivableAsPaid } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(
      markReceivableAsPaid("non-existent", COMPANY_ID)
    ).rejects.toThrow("Conta a receber não encontrada");
  });

  it("should throw on double payment (idempotency check)", async () => {
    mockFindFirst.mockResolvedValue(paidReceivable);
    const { markReceivableAsPaid } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(markReceivableAsPaid("rec-1", COMPANY_ID)).rejects.toThrow(
      "Esta conta já foi paga"
    );
    // Must NOT call update or audit on double-payment attempt
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it("should throw (RBAC) when access is denied", async () => {
    mockRequireCompanyAccess.mockRejectedValue(
      new Error("Acesso negado. Você não tem permissão para acessar esta empresa.")
    );
    const { markReceivableAsPaid } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(
      markReceivableAsPaid("rec-1", "foreign-company")
    ).rejects.toThrow("Acesso negado");
  });

  it("should propagate Prisma errors from update (DB failure)", async () => {
    mockUpdate.mockRejectedValue(new Error("Record to update not found"));
    const { markReceivableAsPaid } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(markReceivableAsPaid("rec-1", COMPANY_ID)).rejects.toThrow(
      "Record to update not found"
    );
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it("should propagate Prisma errors from findFirst (DB failure)", async () => {
    mockFindFirst.mockRejectedValue(new Error("Connection timed out"));
    const { markReceivableAsPaid } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(markReceivableAsPaid("rec-1", COMPANY_ID)).rejects.toThrow(
      "Connection timed out"
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: listClientsForSelect
// ---------------------------------------------------------------------------

describe("listClientsForSelect", () => {
  const sharedIds = [COMPANY_ID, "company-shared-1"];
  const clientList = [
    { id: "client-1", name: "Empresa X" },
    { id: "client-2", name: "Empresa Y" },
  ];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRequireCompanyAccess.mockResolvedValue(SESSION);
    mockGetSharedCompanyIds.mockResolvedValue(sharedIds);
    mockClientFindMany.mockResolvedValue(clientList);
  });

  it("should call requireCompanyAccess with the correct companyId", async () => {
    const { listClientsForSelect } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await listClientsForSelect(COMPANY_ID);
    expect(mockRequireCompanyAccess).toHaveBeenCalledWith(COMPANY_ID);
  });

  it("should call getSharedCompanyIds to resolve shared company scope", async () => {
    const { listClientsForSelect } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await listClientsForSelect(COMPANY_ID);
    expect(mockGetSharedCompanyIds).toHaveBeenCalledWith(COMPANY_ID);
  });

  it("should query clients scoped to all shared company IDs", async () => {
    const { listClientsForSelect } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await listClientsForSelect(COMPANY_ID);
    expect(mockClientFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: expect.objectContaining({ in: sharedIds }),
        }),
      })
    );
  });

  it("should return the list of clients", async () => {
    const { listClientsForSelect } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    const result = await listClientsForSelect(COMPANY_ID);
    expect(result).toEqual(clientList);
    expect(result).toHaveLength(2);
  });

  it("should return empty list when no clients exist", async () => {
    mockClientFindMany.mockResolvedValue([]);
    const { listClientsForSelect } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    const result = await listClientsForSelect(COMPANY_ID);
    expect(result).toEqual([]);
  });

  it("should throw (RBAC) when access is denied", async () => {
    mockRequireCompanyAccess.mockRejectedValue(
      new Error("Acesso negado. Você não tem permissão para acessar esta empresa.")
    );
    const { listClientsForSelect } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(listClientsForSelect("foreign-company")).rejects.toThrow(
      "Acesso negado"
    );
  });

  it("should propagate Prisma errors from client findMany (DB failure)", async () => {
    mockClientFindMany.mockRejectedValue(new Error("Connection timed out"));
    const { listClientsForSelect } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(listClientsForSelect(COMPANY_ID)).rejects.toThrow(
      "Connection timed out"
    );
  });

  it("should propagate errors from getSharedCompanyIds (service failure)", async () => {
    mockGetSharedCompanyIds.mockRejectedValue(
      new Error("Shared service unavailable")
    );
    const { listClientsForSelect } = await import(
      "@/app/(app)/financeiro/receber/actions"
    );
    await expect(listClientsForSelect(COMPANY_ID)).rejects.toThrow(
      "Shared service unavailable"
    );
    expect(mockClientFindMany).not.toHaveBeenCalled();
  });
});
