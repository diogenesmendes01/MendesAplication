const WHATSAPP_SERVICE_URL =
  process.env.WHATSAPP_SERVICE_URL || "http://localhost:3001";
const WHATSAPP_SERVICE_API_KEY =
  process.env.WHATSAPP_SERVICE_API_KEY || "";

interface WhatsAppServiceResponse {
  messageId?: string;
  isConnected?: boolean;
  isConnecting?: boolean;
  lastError?: string | null;
  error?: string;
  [key: string]: unknown;
}

async function whatsappFetch(
  path: string,
  options: RequestInit = {}
): Promise<WhatsAppServiceResponse> {
  const res = await fetch(`${WHATSAPP_SERVICE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      apikey: WHATSAPP_SERVICE_API_KEY,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WhatsApp Service error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function sendTextMessage(
  companyId: string,
  to: string,
  text: string
): Promise<string | null> {
  const data = await whatsappFetch("/message/send-text", {
    method: "POST",
    body: JSON.stringify({
      companyId,
      to,
      content: text,
    }),
  });

  return data.messageId ?? null;
}

export async function sendMediaMessage(
  companyId: string,
  to: string,
  mediaUrl: string,
  fileName: string,
  caption?: string
): Promise<string | null> {
  const data = await whatsappFetch("/message/send-media", {
    method: "POST",
    body: JSON.stringify({
      companyId,
      to,
      mediaUrl,
      caption: caption ?? "",
      mediaType: "document",
    }),
  });

  return data.messageId ?? null;
}

export async function getInstanceStatus(
  companyId: string
): Promise<{ connected: boolean; state: string }> {
  try {
    const data = await whatsappFetch(`/instance/${companyId}/status`);
    const isConnected = data.isConnected === true;
    return {
      connected: isConnected,
      state: isConnected
        ? "open"
        : data.isConnecting
          ? "connecting"
          : "disconnected",
    };
  } catch {
    return { connected: false, state: "error" };
  }
}
