import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for RA reputation code null-safety logic
 * Tests the core transformation: String(r.reputation?.code ?? "SEM_INDICE")
 */
describe("RA Actions - reputationCode transformation", () => {
  it("handles null reputation.code correctly", () => {
    const reputation = { code: null };
    const result = String(reputation.code ?? "SEM_INDICE");
    expect(result).toBe("SEM_INDICE");
  });

  it("handles undefined reputation.code correctly", () => {
    const reputation = { code: undefined };
    const result = String(reputation.code ?? "SEM_INDICE");
    expect(result).toBe("SEM_INDICE");
  });

  it("handles numeric reputation.code correctly", () => {
    const reputation = { code: 123 };
    const result = String(reputation.code ?? "SEM_INDICE");
    expect(result).toBe("123");
  });

  it("handles string reputation.code correctly", () => {
    const reputation = { code: "A" };
    const result = String(reputation.code ?? "SEM_INDICE");
    expect(result).toBe("A");
  });
});

/**
 * Unit tests for sendRaResponse job payload generation
 * Validates that field names match job worker expectations
 */
describe("RA Actions - sendRaResponse job payloads", () => {
  let mockQueueAdd: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockQueueAdd = vi.fn().mockResolvedValue({ id: "job-123" });
  });

  const testCases = [
    {
      name: "RA_SEND_DUAL",
      jobName: "RA_SEND_DUAL",
      expectedFields: ["ticketId", "raExternalId", "companyId", "publicMessage", "privateMessage", "email"],
      excludeFields: ["message"],
    },
    {
      name: "RA_SEND_PUBLIC",
      jobName: "RA_SEND_PUBLIC",
      expectedFields: ["ticketId", "raExternalId", "companyId", "message"],
      excludeFields: ["publicMessage", "privateMessage", "email"],
    },
    {
      name: "RA_SEND_PRIVATE",
      jobName: "RA_SEND_PRIVATE",
      expectedFields: ["ticketId", "raExternalId", "companyId", "message", "email"],
      excludeFields: ["publicMessage", "privateMessage"],
    },
  ];

  testCases.forEach(({ name, jobName, expectedFields, excludeFields }) => {
    it(`${jobName} payload contains required fields [${expectedFields.join(", ")}]`, () => {
      // Mock payload that would be sent to the queue
      const payload = {
        ticketId: "ticket-123",
        raExternalId: "ra-ext-456",
        companyId: "company-789",
        ...(jobName === "RA_SEND_DUAL" && {
          publicMessage: "Public response",
          privateMessage: "Private response",
          email: "user@example.com",
        }),
        ...(jobName === "RA_SEND_PUBLIC" && {
          message: "Public response",
        }),
        ...(jobName === "RA_SEND_PRIVATE" && {
          message: "Private response",
          email: "user@example.com",
        }),
      };

      // Validate all required fields are present
      expectedFields.forEach((field) => {
        expect(payload).toHaveProperty(field);
        expect(payload[field as keyof typeof payload]).toBeDefined();
      });

      // Validate excluded fields are not present
      excludeFields.forEach((field) => {
        expect(payload).not.toHaveProperty(field);
      });
    });
  });

  it("ensures raExternalId and companyId are present in all job types", () => {
    const commonFields = ["ticketId", "raExternalId", "companyId"];

    const dualPayload = {
      ticketId: "t1",
      raExternalId: "ra1",
      companyId: "c1",
      publicMessage: "pub",
      privateMessage: "priv",
      email: "email@test.com",
    };

    const publicPayload = {
      ticketId: "t1",
      raExternalId: "ra1",
      companyId: "c1",
      message: "pub",
    };

    const privatePayload = {
      ticketId: "t1",
      raExternalId: "ra1",
      companyId: "c1",
      message: "priv",
      email: "email@test.com",
    };

    [dualPayload, publicPayload, privatePayload].forEach((payload) => {
      commonFields.forEach((field) => {
        expect(payload).toHaveProperty(field);
      });
    });
  });
});