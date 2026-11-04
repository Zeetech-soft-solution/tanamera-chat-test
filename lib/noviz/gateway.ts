/**
 * Calls Noviz AI's chat gateway from your Next.js server. Server only: the
 * Noviz AI tenant key and the user's ERPNext key never reach the browser.
 *
 * You manage your users, their sessions and their ERPNext keys; pass them in
 * as a NovizUser. Noviz AI stores none of it. The chat session is yours too:
 * pass your conversationId and Noviz AI keeps the conversation going.
 *
 * Settings (.env):
 *   NOVIZ_GATEWAY_URL=https://tanamera-gateway.noviz.in
 *   NOVIZ_TENANT_KEY=tnt_...
 */
import "server-only";
import { Agent, fetch, type Response as GatewayResponse } from "undici";

const GATEWAY_URL = process.env.NOVIZ_GATEWAY_URL!;
const TENANT_KEY = process.env.NOVIZ_TENANT_KEY!;

// The connection to the gateway stays open between messages: a new one costs
// DNS, TCP and TLS before the first byte, and a far server pays that on every
// message once the default pool has closed it (after 4 s idle). After the
// first request it is kept 50 s and warmed every 45 s, so later messages
// start at once. undici's own fetch with its pool works the same on any Node.
const connection = new Agent({ keepAliveTimeout: 50_000, keepAliveMaxTimeout: 50_000 });
let warm = false;
function keepWarm() {
  if (warm) return;
  warm = true;
  setInterval(() => {
    fetch(`${GATEWAY_URL}/healthz`, { dispatcher: connection }).then((r) => r.arrayBuffer()).catch(() => undefined);
  }, 45_000).unref();
}

/** Who is chatting, from your own session and your own key store. */
export interface NovizUser {
  /** Your chat's user id. */
  chatUser: string;
  /** The ERPNext API key and secret you assigned to this user. */
  erpApiKey: string;
  erpApiSecret: string;
}

export interface NovizAnswer {
  conversationId: string;
  status: "final";
  turnId: string;
  reply: string; // markdown
  html: string; // Noviz AI's tables / cards / charts (render with NovizAnswer)
  document: unknown | null; // a document attached to the answer, or null
}

export class NovizError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

async function call(user: NovizUser, path: string, init: { method: "GET" | "POST"; body?: unknown }) {
  const response = await fetch(`${GATEWAY_URL}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${TENANT_KEY}`,
      "X-Chat-User": user.chatUser,
      "X-ERP-Authorization": `token ${user.erpApiKey}:${user.erpApiSecret}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    dispatcher: connection,
  });
  keepWarm();
  const json: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new NovizError(response.status, json.error?.code || "error", json.error?.message || `Noviz AI answered ${response.status}`);
  return json;
}

/** A long answer comes back as "working": continue until it is final. */
async function untilFinal(user: NovizUser, conversationId: string | undefined, answer: any): Promise<NovizAnswer> {
  while (answer.status === "working") {
    answer = await call(user, "/v1/chat/continue", { method: "POST", body: { conversationId: conversationId || answer.conversationId, turnId: answer.turnId } });
  }
  return answer;
}

/** Your chat's own request: { message, conversationId }. */
export async function askNoviz(user: NovizUser, message: string, conversationId?: string): Promise<NovizAnswer> {
  const answer = await call(user, "/v1/chat", { method: "POST", body: { message, conversationId, can_continue: true } });
  return untilFinal(user, answer.conversationId, answer);
}

/**
 * The same question, answered as a stream (Server-Sent Events): `step` events
 * while Noviz AI works ({ id, label, status: "running" | "done" | "error", ms }),
 * then one `answer` event (the NovizAnswer above) or one `error` event
 * ({ error: { code, message } }). Returns the gateway's response; its body is
 * the stream, passed on to the browser as it is.
 */
export async function streamNoviz(user: NovizUser, message: string, conversationId?: string): Promise<GatewayResponse> {
  const response = await fetch(`${GATEWAY_URL}/v1/chat/stream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TENANT_KEY}`,
      "X-Chat-User": user.chatUser,
      "X-ERP-Authorization": `token ${user.erpApiKey}:${user.erpApiSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, conversationId }),
    dispatcher: connection,
  });
  keepWarm();
  if (!response.ok) {
    const json: any = await response.json().catch(() => ({}));
    throw new NovizError(response.status, json.error?.code || "error", json.error?.message || `Noviz AI answered ${response.status}`);
  }
  return response;
}

/** "Show me more" under a result: the next page, without asking the AI again. */
export async function novizNextPage(user: NovizUser, tool: string, args: Record<string, unknown>, conversationId?: string): Promise<NovizAnswer> {
  const answer = await call(user, "/v1/chat/next-page", { method: "POST", body: { tool, args, conversationId, can_continue: true } });
  return untilFinal(user, conversationId, answer);
}

/** "Download PDF" under an answer: the PDF for the answer's report spec. */
export async function novizPdf(user: NovizUser, spec: string): Promise<GatewayResponse> {
  const response = await fetch(`${GATEWAY_URL}/v1/chat/pdf?spec=${encodeURIComponent(spec)}`, {
    headers: {
      Authorization: `Bearer ${TENANT_KEY}`,
      "X-Chat-User": user.chatUser,
      "X-ERP-Authorization": `token ${user.erpApiKey}:${user.erpApiSecret}`,
    },
    dispatcher: connection,
  });
  if (!response.ok) {
    const json: any = await response.json().catch(() => ({}));
    throw new NovizError(response.status, json.error?.code || "error", json.error?.message || `Noviz AI answered ${response.status}`);
  }
  return response;
}

/** "Download PDF" of one document: ERPNext's own print, as the user. */
export async function novizDocumentPdf(user: NovizUser, doctype: string, name: string, format?: string): Promise<GatewayResponse> {
  const query = new URLSearchParams({ doctype, name, ...(format ? { format } : {}) });
  const response = await fetch(`${GATEWAY_URL}/v1/chat/document-pdf?${query}`, {
    headers: {
      Authorization: `Bearer ${TENANT_KEY}`,
      "X-Chat-User": user.chatUser,
      "X-ERP-Authorization": `token ${user.erpApiKey}:${user.erpApiSecret}`,
    },
    dispatcher: connection,
  });
  if (!response.ok) {
    const json: any = await response.json().catch(() => ({}));
    throw new NovizError(response.status, json.error?.code || "error", json.error?.message || `Noviz AI answered ${response.status}`);
  }
  return response;
}

/** The chat's + menu items (Approvals, Mail, ...). */
export async function novizMenu(user: NovizUser): Promise<{ id: string; label: string; prompt?: string; empty?: string }[]> {
  return (await call(user, "/v1/chat/menu", { method: "GET" })).items || [];
}
