/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { setCobrefacilConfig } from "../actions";

// Mock dependencies
vi.mock("@/lib/rbac", () => ({
  requireCompanyAccess: vi.fn(async (companyId: string) => ({
    userId: "test-user-123",
    companyId,
  })),
}));

vi.mock("@/lib/audit", () => ({
  logAuditEvent: vi.fn(async () => {}),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: {
      update: vi.fn(),
    },
  },
}));

describe("setCobrefacilConfig", () => {
  const companyId = "company-123";
  const testAddress = {
    zipCode: "13000000",
    street: "Avenida Teste",
    number: "1000",
    complement: "Sala 100",
    neighborhood: "Centro",
    city: "Campinas",
    state: "SP",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("atualiza cobrefacilConfig da empresa", async () => {
    (prisma.company.update as any).mockResolvedValue({
      id: companyId,
      cobrefacilConfig: testAddress,
    });

    const result = await setCobrefacilConfig(companyId, testAddress);

    expect(result.success).toBe(true);
    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { id: companyId },
      data: { cobrefacilConfig: testAddress },
    });
  });

  it("remove cobrefacilConfig quando config é null", async () => {
    (prisma.company.update as any).mockResolvedValue({
      id: companyId,
      cobrefacilConfig: null,
    });

    const result = await setCobrefacilConfig(companyId, null);

    expect(result.success).toBe(true);
    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { id: companyId },
      data: { cobrefacilConfig: Prisma.JsonNull },
    });
  });

  it("suporta endereço sem complement", async () => {
    const addressWithoutComplement = { ...testAddress };
    delete addressWithoutComplement.complement;

    (prisma.company.update as any).mockResolvedValue({
      id: companyId,
      cobrefacilConfig: addressWithoutComplement,
    });

    const result = await setCobrefacilConfig(companyId, addressWithoutComplement);

    expect(result.success).toBe(true);
    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { id: companyId },
      data: { cobrefacilConfig: addressWithoutComplement },
    });
  });

  it("rejeita endereço com campos obrigatórios ausentes", async () => {
    const incompleteAddress = {
      zipCode: "13000000",
      street: "Avenida Teste",
      // missing number, neighborhood, city, state
    };

    await expect(
      setCobrefacilConfig(companyId, incompleteAddress as unknown as any),
    ).rejects.toThrow("Campo obrigatório inválido");

    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it("rejeita campos obrigatórios vazios", async () => {
    const addressWithEmptyNumber = {
      ...testAddress,
      number: "   ", // whitespace-only
    };

    await expect(
      setCobrefacilConfig(companyId, addressWithEmptyNumber),
    ).rejects.toThrow("Campo obrigatório inválido");

    expect(prisma.company.update).not.toHaveBeenCalled();
  });
});
