const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || "http://localhost:8080";
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || "";

interface EvolutionResponse {
  key?: { id?: string };
  status?: string;
  error?: string;
  [key: string]: unknown;
}

async function evolutionFetch(
  path: string,
  options: RequestInit = {}
): Promise<EvolutionResponse> {
  const res = await fetch(`${EVOLUTION_API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      apikey: EVOLUTION_API_KEY,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Evolution API error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function sendTextMessage(
  instanceName: string,
  to: string,
  text: string
): Promise<string | null> {
  const data = await evolutionFetch(`/message/sendText/${instanceName}`, {
    method: "POST",
    body: JSON.stringify({
      number: to,
      text,
    }),
  });

  return data.key?.id ?? null;
}

export async function sendMediaMessage(
  instanceName: string,
  to: string,
  mediaUrl: string,
  fileName: string,
  caption?: string
): Promise<string | null> {
  const data = await evolutionFetch(`/message/sendMedia/${instanceName}`, {
    method: "POST",
    body: JSON.stringify({
      number: to,
      mediatype: "document",
      media: mediaUrl,
      fileName,
      caption: caption ?? "",
    }),
  });

  return data.key?.id ?? null;
}

export async function getInstanceStatus(
  instanceName: string
): Promise<{ connected: boolean; state: string }> {
  try {
    const data = await evolutionFetch(`/instance/connectionState/${instanceName}`);
    const state = (data.state as string) ?? "unknown";
    return {
      connected: state === "open",
      state,
    };
  } catch {
    return { connected: false, state: "error" };
  }
}
