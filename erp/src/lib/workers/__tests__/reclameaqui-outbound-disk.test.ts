import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Mock prisma
// ---------------------------------------------------------------------------

const mockFindUnique = vi.fn();
const mockFindFirst = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: { findUnique: (...a: unknown[]) => mockFindUnique(...a), update: (...a: unknown[]) => mockUpdate(...a) },
    ticketMessage: { create: (...a: unknown[]) => mockCreate(...a), findFirst: (...a: unknown[]) => mockFindFirst(...a) },
  },
}));

// ---------------------------------------------------------------------------
// Mock encryption
// ---------------------------------------------------------------------------

vi.mock("@/lib/encryption", () => ({
  decryptConfig: (c: unknown) => c,
}));

// ---------------------------------------------------------------------------
// Mock RA Client
// ---------------------------------------------------------------------------

const mockAuthenticate = vi.fn();
const mockSendPrivateMessage = vi.fn();
const mockRequestModeration = vi.fn();

vi.mock("@/lib/reclameaqui/client", () => {
  class MockReclameAquiClient {
    constructor(_config: unknown) {}
    authenticate = mockAuthenticate;
    sendPrivateMessage = mockSendPrivateMessage;
    sendPublicMessage = vi.fn();
    requestModeration = mockRequestModeration;
    requestEvaluation = vi.fn();
    finishPrivateMessage = vi.fn();
  }
  class MockReclameAquiError extends Error {
    code: number;
    constructor(msg: string, code: number) {
      super(msg);
      this.code = code;
    }
  }
  return {
    ReclameAquiClient: MockReclameAquiClient,
    ReclameAquiError: MockReclameAquiError,
  };
});

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { processReclameAquiOutbound } from "../reclameaqui-outbound";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEMP_DIR = `/tmp/ra-uploads-test-${crypto.randomUUID()}`;

function fakeTicket(overrides = {}) {
  return {
    id: "ticket-1",
    raExternalId: "ra-ext-1",
    channel: {
      id: "ch-1",
      type: "RECLAMEAQUI",
      isActive: true,
      config: { clientId: "cid", clientSecret: "cs", baseUrl: "https://ra.test" },
    },
    raCanEvaluate: true,
    raCanModerate: true,
    ...overrides,
  };
}

function fakeJob(name: string, data: Record<string, unknown>) {
  return { id: "job-1", name, data } as any;
}

async function writeTempFile(ticketId: string, filename: string, content: string): Promise<string> {
  const dir = path.join(TEMP_DIR, ticketId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, content);
  return filePath;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reclameaqui-outbound disk upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue(fakeTicket());
    mockCreate.mockResolvedValue({ id: "msg-1" });
    mockUpdate.mockResolvedValue({});
  });

  afterEach(async () => {
    // Cleanup temp dir
    await fs.rm(TEMP_DIR, { recursive: true, force: true }).catch(() => {});
  });

  // -------------------------------------------------------------------------
  // RA_SEND_PRIVATE with filePaths (new format)
  // -------------------------------------------------------------------------

  it("should read files from disk, send, and cleanup", async () => {
    const fp1 = await writeTempFile("ticket-1", "file1.pdf", "pdf-content-1");
    const fp2 = await writeTempFile("ticket-1", "file2.jpg", "jpg-content-2");

    await processReclameAquiOutbound(
      fakeJob("RA_SEND_PRIVATE", {
        ticketId: "ticket-1",
        message: "Hello",
        email: "test@test.com",
        filePaths: [fp1, fp2],
      })
    );

    // Verify authenticate was called
    expect(mockAuthenticate).toHaveBeenCalledOnce();

    // Verify sendPrivateMessage was called with buffers
    expect(mockSendPrivateMessage).toHaveBeenCalledOnce();
    const [raId, msg, email, buffers] = mockSendPrivateMessage.mock.calls[0];
    expect(raId).toBe("ra-ext-1");
    expect(msg).toBe("Hello");
    expect(email).toBe("test@test.com");
    expect(buffers).toHaveLength(2);
    expect(buffers![0].toString()).toBe("pdf-content-1");
    expect(buffers![1].toString()).toBe("jpg-content-2");

    // Verify files were cleaned up
    await expect(fs.access(fp1)).rejects.toThrow();
    await expect(fs.access(fp2)).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // RA_SEND_PRIVATE with base64 files (legacy backward compat)
  // -------------------------------------------------------------------------

  it("should still handle legacy base64 files", async () => {
    const b64_1 = Buffer.from("legacy-content-1").toString("base64");
    const b64_2 = Buffer.from("legacy-content-2").toString("base64");

    await processReclameAquiOutbound(
      fakeJob("RA_SEND_PRIVATE", {
        ticketId: "ticket-1",
        message: "Legacy hello",
        email: "legacy@test.com",
        files: [b64_1, b64_2],
      })
    );

    expect(mockSendPrivateMessage).toHaveBeenCalledOnce();
    const [, , , buffers] = mockSendPrivateMessage.mock.calls[0];
    expect(buffers).toHaveLength(2);
    expect(buffers![0].toString()).toBe("legacy-content-1");
    expect(buffers![1].toString()).toBe("legacy-content-2");
  });

  // -------------------------------------------------------------------------
  // Cleanup happens even on failure
  // -------------------------------------------------------------------------

  it("should cleanup files even when send fails", async () => {
    const fp = await writeTempFile("ticket-1", "file.pdf", "content");

    mockSendPrivateMessage.mockRejectedValueOnce(new Error("API exploded"));

    await expect(
      processReclameAquiOutbound(
        fakeJob("RA_SEND_PRIVATE", {
          ticketId: "ticket-1",
          message: "Will fail",
          email: "test@test.com",
          filePaths: [fp],
        })
      )
    ).rejects.toThrow("API exploded");

    // File should still be cleaned up
    await expect(fs.access(fp)).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // RA_SEND_PRIVATE without files
  // -------------------------------------------------------------------------

  it("should handle private message without files", async () => {
    await processReclameAquiOutbound(
      fakeJob("RA_SEND_PRIVATE", {
        ticketId: "ticket-1",
        message: "No files",
        email: "test@test.com",
      })
    );

    expect(mockSendPrivateMessage).toHaveBeenCalledOnce();
    const [, , , buffers] = mockSendPrivateMessage.mock.calls[0];
    expect(buffers).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // RA_REQUEST_MODERATION with filePaths
  // -------------------------------------------------------------------------

  it("should read moderation files from disk and cleanup", async () => {
    const fp = await writeTempFile("ticket-1", "evidence.pdf", "evidence-data");

    await processReclameAquiOutbound(
      fakeJob("RA_REQUEST_MODERATION", {
        ticketId: "ticket-1",
        reason: 4,
        message: "Duplicate complaint",
        filePaths: [fp],
      })
    );

    expect(mockRequestModeration).toHaveBeenCalledOnce();
    const [, , , , buffers] = mockRequestModeration.mock.calls[0];
    expect(buffers).toHaveLength(1);
    expect(buffers![0].toString()).toBe("evidence-data");

    // File cleaned up
    await expect(fs.access(fp)).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // RA_REQUEST_MODERATION cleanup on failure
  // -------------------------------------------------------------------------

  it("should cleanup moderation files even on failure", async () => {
    const fp = await writeTempFile("ticket-1", "evidence.pdf", "evidence-data");

    mockRequestModeration.mockRejectedValueOnce(new Error("Mod failed"));

    await expect(
      processReclameAquiOutbound(
        fakeJob("RA_REQUEST_MODERATION", {
          ticketId: "ticket-1",
          reason: 4,
          message: "Duplicate",
          filePaths: [fp],
        })
      )
    ).rejects.toThrow("Mod failed");

    await expect(fs.access(fp)).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // filePaths takes precedence over files
  // -------------------------------------------------------------------------

  it("should prefer filePaths over legacy files when both present", async () => {
    const fp = await writeTempFile("ticket-1", "new.pdf", "new-content");
    const b64 = Buffer.from("old-content").toString("base64");

    await processReclameAquiOutbound(
      fakeJob("RA_SEND_PRIVATE", {
        ticketId: "ticket-1",
        message: "Both formats",
        email: "test@test.com",
        filePaths: [fp],
        files: [b64],
      })
    );

    const [, , , buffers] = mockSendPrivateMessage.mock.calls[0];
    expect(buffers).toHaveLength(1);
    // Should use disk content, not base64
    expect(buffers![0].toString()).toBe("new-content");
  });
});
