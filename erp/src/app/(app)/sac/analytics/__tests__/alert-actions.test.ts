import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindMany = vi.fn();
const mockFindUniqueOrThrow = vi.fn();
const mockUpsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiAlert: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findUniqueOrThrow: (...args: unknown[]) => mockFindUniqueOrThrow(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
    },
  },
}));

vi.mock("@/lib/rbac", () => ({
  requireCompanyAccess: vi.fn().mockResolvedValue({ userId: "user-1", role: "ADMIN" }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const COMPANY_ID = "company-1";

describe("Alert Actions", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe("listAlerts", () => {
    it("returns alerts for the company", async () => {
      const alerts = [{
        id: "alert-1", companyId: COMPANY_ID, metricType: "cost_daily",
        threshold: 10, operator: "gt", enabled: true,
        lastTriggeredAt: null, createdAt: new Date(), updatedAt: new Date(),
      }];
      mockFindMany.mockResolvedValue(alerts);

      const { listAlerts } = await import("../alert-actions");
      const result = await listAlerts(COMPANY_ID);

      expect(result).toEqual(alerts);
      expect(mockFindMany).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID },
        orderBy: { createdAt: "asc" },
      });
    });
  });

  describe("upsertAlert", () => {
    it("creates or updates an alert", async () => {
      const alert = {
        id: "alert-1", companyId: COMPANY_ID, metricType: "cost_daily",
        threshold: 15, operator: "gt", enabled: true,
        lastTriggeredAt: null, createdAt: new Date(), updatedAt: new Date(),
      };
      mockUpsert.mockResolvedValue(alert);

      const { upsertAlert } = await import("../alert-actions");
      const result = await upsertAlert({
        companyId: COMPANY_ID, metricType: "cost_daily", threshold: 15, operator: "gt",
      });

      expect(result).toEqual(alert);
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId_metricType: { companyId: COMPANY_ID, metricType: "cost_daily" } },
        }),
      );
    });
  });

  describe("toggleAlert", () => {
    it("fetches alert to verify tenant then toggles", async () => {
      mockFindUniqueOrThrow.mockResolvedValue({ id: "alert-1", companyId: COMPANY_ID });
      mockUpdate.mockResolvedValue({ id: "alert-1", enabled: false });

      const { toggleAlert } = await import("../alert-actions");
      await toggleAlert("alert-1", false);

      expect(mockFindUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "alert-1" } });
      expect(mockUpdate).toHaveBeenCalledWith({ where: { id: "alert-1" }, data: { enabled: false } });
    });
  });

  describe("deleteAlert", () => {
    it("fetches alert to verify tenant then deletes", async () => {
      mockFindUniqueOrThrow.mockResolvedValue({ id: "alert-1", companyId: COMPANY_ID });
      mockDelete.mockResolvedValue({});

      const { deleteAlert } = await import("../alert-actions");
      await deleteAlert("alert-1");

      expect(mockFindUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "alert-1" } });
      expect(mockDelete).toHaveBeenCalledWith({ where: { id: "alert-1" } });
    });
  });
});
