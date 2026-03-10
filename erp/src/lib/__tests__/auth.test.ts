import { describe, it, expect, beforeAll, vi } from "vitest";

// Mock prisma before auth module loads
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

// Set required env vars before importing auth module
beforeAll(() => {
  process.env.JWT_SECRET = "test-jwt-secret-minimum-32-chars-long!!";
  process.env.REFRESH_SECRET = "test-refresh-secret-minimum-32-chars!!";
});

describe("auth utilities", () => {
  it("should hash and verify a password", async () => {
    const { hashPassword, comparePassword } = await import("@/lib/auth");
    const password = "SecurePass123!";
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(await comparePassword(password, hash)).toBe(true);
    expect(await comparePassword("WrongPass", hash)).toBe(false);
  });

  it("should generate and verify access tokens", async () => {
    const { generateAccessToken, verifyAccessToken } = await import(
      "@/lib/auth"
    );
    const payload = { userId: "user-1", email: "test@test.com", role: "ADMIN" };

    const token = generateAccessToken(payload);
    expect(token).toBeTruthy();

    const decoded = verifyAccessToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.userId).toBe("user-1");
    expect(decoded!.email).toBe("test@test.com");
    expect(decoded!.role).toBe("ADMIN");
  });

  it("should generate and verify refresh tokens", async () => {
    const { generateRefreshToken, verifyRefreshToken } = await import(
      "@/lib/auth"
    );
    const payload = { userId: "user-2", email: "t2@test.com", role: "USER" };

    const token = generateRefreshToken(payload);
    const decoded = verifyRefreshToken(token);

    expect(decoded).not.toBeNull();
    expect(decoded!.userId).toBe("user-2");
  });

  it("should return null for invalid tokens", async () => {
    const { verifyAccessToken, verifyRefreshToken } = await import(
      "@/lib/auth"
    );

    expect(verifyAccessToken("invalid-token")).toBeNull();
    expect(verifyRefreshToken("invalid-token")).toBeNull();
  });
});
