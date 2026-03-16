import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockTicketMessageFindFirst = vi.fn();
const mockTicketMessageCreate = vi.fn();
const mockClientFindFirst = vi.fn();
const mockAdditionalContactFindFirst = vi.fn();
const mockTicketFindFirst = vi.fn();
const mockTicketCreate = vi.fn();
const mockAiConfigFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticketMessage: {
      findFirst: (...args: unknown[]) => mockTicketMessageFindFirst(...args),
      create: (...args: unknown[]) => mockTicketMessageCreate(...args),
    },
    client: {
      findFirst: (...args: unknown[]) => mockClientFindFirst(...args),
      findUnique: vi.fn().mockResolvedValue({ name: "Test Client" }),
    },
    additionalContact: {
      findFirst: (...args: unknown[]) => mockAdditionalContactFindFirst(...args),
    },
    ticket: {
      findFirst: (...args: unknown[]) => mockTicketFindFirst(...args),
      create: (...args: unknown[]) => mockTicketCreate(...args),
    },
    aiConfig: {
      findUnique: (...args: unknown[]) => mockAiConfigFindUnique(...args),
    },
    attachment: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

const mockAiAgentQueueAdd = vi.fn();

vi.mock("@/lib/queue", () => ({
  aiAgentQueue: {
    add: (...args: unknown[]) => mockAiAgentQueueAdd(...args),
  },
}));

vi.mock("@/lib/encryption", () => ({
  decryptConfig: vi.fn().mockReturnValue({ password: "secret" }),
}));

vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("path")>();
  return { ...actual, default: actual };
});

// ─── Fixtures ──────────────────────────────────────────────────────────────

const COMPANY_ID = "company-test-1";
const TICKET_ID = "ticket-test-1";
const MESSAGE_ID = "<unique-msg-id@test.com>";
const TEXT_BODY = "Content-Type: text/plain\r\n\r\nOlá, preciso de ajuda com meu pedido.";

/** Minimal ImapFlow stub — only what processEmail needs */
const mockImapClient = {} as import("imapflow").ImapFlow;

const mockChannel = {
  id: "channel-test-1",
  companyId: COMPANY_ID,
  config: {
    imapHost: "imap.example.com",
    imapPort: 993,
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    email: "support@example.com",
    password: "secret",
  },
  lastSyncUid: null,
  lastSyncUidSent: null,
};

/** Builds a minimal FetchMessageObject for tests */
function buildMsg(overrides: Record<string, unknown> = {}): import("imapflow").FetchMessageObject {
  return {
    uid: 42,
    seq: 1,
    source: Buffer.from(TEXT_BODY),
    bodyStructure: null,
    envelope: {
      messageId: MESSAGE_ID,
      subject: "Ajuda com pedido",
      from: [{ address: "cliente@exemplo.com", name: "Cliente" }],
      to: [{ address: "support@example.com", name: "Suporte" }],
      date: new Date(),
      inReplyTo: undefined,
      cc: [],
      bcc: [],
      replyTo: [],
      sender: [],
    },
    ...overrides,
  } as unknown as import("imapflow").FetchMessageObject;
}

// ─── Setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default: no duplicate email
  mockTicketMessageFindFirst.mockResolvedValue(null);

  // Default: known client
  mockClientFindFirst.mockResolvedValue({ id: "client-test-1" });
  mockAdditionalContactFindFirst.mockResolvedValue(null);

  // Default: existing open ticket matching subject
  mockTicketFindFirst.mockResolvedValue({ id: TICKET_ID, subject: "Ajuda com pedido" });

  // Default: message created successfully
  mockTicketMessageCreate.mockResolvedValue({ id: "msg-test-1" });
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("email-inbound — AI agent enqueuing block", () => {
  it("happy-path: enfileira job de IA para email INBOUND com payload correto", async () => {
    const { processEmail } = await import("../email-inbound");
    await processEmail(mockImapClient, buildMsg(), mockChannel, /* isSent */ false);

    expect(mockAiAgentQueueAdd).toHaveBeenCalledOnce();
    expect(mockAiAgentQueueAdd).toHaveBeenCalledWith(
      "process-message",
      expect.objectContaining({
        ticketId: TICKET_ID,
        companyId: COMPANY_ID,
        channel: "EMAIL",
      })
    );
    // email-inbound.ts não deve mais consultar aiConfig (evita double DB query)
    expect(mockAiConfigFindUnique).not.toHaveBeenCalled();
  });

  it("enfileira sempre para INBOUND: o guard emailEnabled é responsabilidade do runAgent", async () => {
    // email-inbound.ts não faz mais pré-checagem de aiConfig — enfileira incondicionalmente.
    // O guard de enabled/emailEnabled é feito dentro de runAgent (single DB query, sem double-fetch).
    const { processEmail } = await import("../email-inbound");
    await processEmail(mockImapClient, buildMsg(), mockChannel, /* isSent */ false);

    // Deve enfileirar — runAgent rejeitará internamente se emailEnabled=false
    expect(mockAiAgentQueueAdd).toHaveBeenCalledOnce();
    // email-inbound.ts não deve mais consultar aiConfig diretamente
    expect(mockAiConfigFindUnique).not.toHaveBeenCalled();
  });

  it("skip outbound: NÃO enfileira para mensagens OUTBOUND (isSent=true)", async () => {
    // aiConfig não deve sequer ser consultado para mensagens outbound
    mockAiConfigFindUnique.mockResolvedValue({ enabled: true, emailEnabled: true });

    const { processEmail } = await import("../email-inbound");
    await processEmail(mockImapClient, buildMsg(), mockChannel, /* isSent */ true);

    expect(mockAiAgentQueueAdd).not.toHaveBeenCalled();
    // Verifica também que aiConfig nem foi consultado (short-circuit na condição direction === "INBOUND")
    expect(mockAiConfigFindUnique).not.toHaveBeenCalled();
  });
});
