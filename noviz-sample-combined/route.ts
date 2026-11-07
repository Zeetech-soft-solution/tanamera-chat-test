/**
 * ============================================================================
 * Noviz AI: every chat route in ONE file
 * ============================================================================
 *
 * Noviz AI is one of your chat's agents, next to /api/agents/red/member-segments,
 * business-analysis and it-assistance. Copy this file into your Next.js app at
 * app/api/agents/red/noviz/route.ts and it answers all of these:
 *
 *   POST /api/agents/red/noviz                       1. Chat: { message, conversationId } -> the answer
 *   POST /api/agents/red/noviz?route=stream          2. Stream: the steps while it works, then the answer
 *   POST /api/agents/red/noviz?route=next-page       3. Show more: { tool, args, conversationId } -> next page
 *   GET  /api/agents/red/noviz?route=menu            4. Menu: the + menu items (Approvals, Mail, ...)
 *   GET  /api/agents/red/noviz?route=pdf             5. Report PDF: &spec=<the answer's report spec>
 *   GET  /api/agents/red/noviz?route=document-pdf    6. Document PDF: &doctype=&name=[&format=]
 *
 * Server only: the Noviz AI tenant key and the user's ERPNext key never reach
 * the browser. You manage your users, sessions and ERPNext keys; Noviz AI
 * stores none of it.
 *
 * The one thing you change: currentNovizUser() at the bottom of this file.
 *
 * Settings (.env):
 *   NOVIZ_GATEWAY_URL=https://tanamera-gateway.noviz.in
 *   NOVIZ_TENANT_KEY=tnt_...
 */
import { NextResponse } from "next/server";
import { Agent, fetch } from "undici";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // a long answer continues on the server

// ----------------------------------------------------------------------------
// Routing: ?route= says which of the six routes was called (none = chat)
// ----------------------------------------------------------------------------

const routeOf = (request: Request) => new URL(request.url).searchParams.get("route") || "";

export async function POST(request: Request) {
  const route = routeOf(request);
  if (route === "") return chat(request);
  if (route === "stream") return stream(request);
  if (route === "next-page") return nextPage(request);
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET(request: Request) {
  const route = routeOf(request);
  if (route === "menu") return menu();
  if (route === "pdf") return reportPdf(request);
  if (route === "document-pdf") return documentPdf(request);
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

// ----------------------------------------------------------------------------
// 1. Chat: POST { message, conversationId }
//    Answers with an assistant message in your chat's own message shape, plus
//    Noviz AI's rendered result (tables, cards, charts) in `html`.
// ----------------------------------------------------------------------------

async function chat(request: Request) {
  return withUser(async (user) => {
    const { message, conversationId } = await request.json();
    if (typeof message !== "string" || !message.trim()) return NextResponse.json({ error: "message is required" }, { status: 400 });

    let answer = await gateway(user, "POST", "/v1/chat", { message: message.trim(), conversationId, can_continue: true });
    answer = await untilFinal(user, answer.conversationId, answer);
    return NextResponse.json({ conversationId: answer.conversationId, message: { ...assistantMessage(answer), activities: [], references: [] } });
  });
}

// ----------------------------------------------------------------------------
// 2. Stream: POST ?route=stream { message, conversationId } -> text/event-stream
//    The gateway's events pass through as they are:
//      step    { id, label, status: "running" | "done" | "error", ms }  (while it works)
//      answer  the same answer as route 1 (conversationId, turnId, reply, html, document)
//      error   { error: { code, message } }
//    The browser reads them with readNovizEvents() in Noviz.tsx (this folder).
//    Behind nginx, keep proxy_buffering off for this route.
// ----------------------------------------------------------------------------

async function stream(request: Request) {
  return withUser(async (user) => {
    const { message, conversationId } = await request.json();
    if (typeof message !== "string" || !message.trim()) return NextResponse.json({ error: "message is required" }, { status: 400 });

    const upstream = await gatewayRaw(user, "POST", "/v1/chat/stream", { message: message.trim(), conversationId });
    return new Response(upstream.body as unknown as ReadableStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        // next start compresses responses, which holds events back; a stream is sent as it is.
        "Content-Encoding": "none",
      },
    });
  });
}

// ----------------------------------------------------------------------------
// 3. Show more: POST ?route=next-page { tool, args, conversationId }
//    "Show me more" under a result: the next page, without asking the AI again.
// ----------------------------------------------------------------------------

async function nextPage(request: Request) {
  return withUser(async (user) => {
    const { tool, args, conversationId } = await request.json();
    if (typeof tool !== "string" || !tool) return NextResponse.json({ error: "tool is required" }, { status: 400 });

    let answer = await gateway(user, "POST", "/v1/chat/next-page", { tool, args: args || {}, conversationId, can_continue: true });
    answer = await untilFinal(user, conversationId, answer);
    return NextResponse.json({ message: assistantMessage(answer) });
  });
}

// ----------------------------------------------------------------------------
// 4. Menu: GET ?route=menu -> { items: [{ id, label, prompt?, empty? }] }
//    The + menu items Noviz AI offers for this ERP (Approvals, Mail, ...).
//    If the gateway cannot answer, the menu is simply empty.
// ----------------------------------------------------------------------------

async function menu() {
  const user = await currentNovizUser();
  if (!user) return notSignedIn();
  try {
    return NextResponse.json({ items: (await gateway(user, "GET", "/v1/chat/menu")).items || [] });
  } catch (e) {
    if (e instanceof NovizError) return NextResponse.json({ items: [] });
    throw e;
  }
}

// ----------------------------------------------------------------------------
// 5. Report PDF: GET ?route=pdf&spec=<the answer's report spec>
//    "Download PDF" under an answer; the gateway builds it from your ERPNext.
// ----------------------------------------------------------------------------

async function reportPdf(request: Request) {
  return withUser(async (user) => {
    const spec = new URL(request.url).searchParams.get("spec");
    if (!spec) return NextResponse.json({ error: "spec is required" }, { status: 400 });

    const pdf = await gatewayRaw(user, "GET", `/v1/chat/pdf?spec=${encodeURIComponent(spec)}`);
    return sendPdf(pdf, "report.pdf");
  });
}

// ----------------------------------------------------------------------------
// 6. Document PDF: GET ?route=document-pdf&doctype=&name=[&format=]
//    "Download PDF" of one document (a quotation, an invoice): ERPNext's own
//    print, as the user.
// ----------------------------------------------------------------------------

async function documentPdf(request: Request) {
  return withUser(async (user) => {
    const params = new URL(request.url).searchParams;
    const doctype = params.get("doctype");
    const name = params.get("name");
    const format = params.get("format");
    if (!doctype || !name) return NextResponse.json({ error: "doctype and name are required" }, { status: 400 });

    const query = new URLSearchParams({ doctype, name, ...(format ? { format } : {}) });
    const pdf = await gatewayRaw(user, "GET", `/v1/chat/document-pdf?${query}`);
    return sendPdf(pdf, "document.pdf");
  });
}

// ============================================================================
// The gateway call (you change nothing below, except currentNovizUser)
// ============================================================================

const GATEWAY_URL = process.env.NOVIZ_GATEWAY_URL!;
const TENANT_KEY = process.env.NOVIZ_TENANT_KEY!;

/** Who is chatting, from your own session and your own key store. */
interface NovizUser {
  chatUser: string; // your chat's user id
  erpApiKey: string; // the ERPNext API key and secret you assigned to this user
  erpApiSecret: string;
}

class NovizError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

// The connection to the gateway stays open between messages: a new one costs
// DNS, TCP and TLS before the first byte, and a far server pays that on every
// message once the default pool has closed it (after 4 s idle). After the
// first request it is kept 50 s and warmed every 45 s, so later messages
// start at once.
const connection = new Agent({ keepAliveTimeout: 50_000, keepAliveMaxTimeout: 50_000 });
let warm = false;
function keepWarm() {
  if (warm) return;
  warm = true;
  setInterval(() => {
    fetch(`${GATEWAY_URL}/healthz`, { dispatcher: connection }).then((r) => r.arrayBuffer()).catch(() => undefined);
  }, 45_000).unref();
}

/** One request to the gateway, as this user. Throws NovizError when it refuses. */
async function gatewayRaw(user: NovizUser, method: "GET" | "POST", path: string, body?: unknown) {
  const response = await fetch(`${GATEWAY_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TENANT_KEY}`,
      "X-Chat-User": user.chatUser,
      "X-ERP-Authorization": `token ${user.erpApiKey}:${user.erpApiSecret}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    dispatcher: connection,
  });
  keepWarm();
  if (!response.ok) {
    const json: any = await response.json().catch(() => ({}));
    throw new NovizError(response.status, json.error?.code || "error", json.error?.message || `Noviz AI answered ${response.status}`);
  }
  return response;
}

/** The same request, read as JSON. */
async function gateway(user: NovizUser, method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  return (await gatewayRaw(user, method, path, body)).json();
}

/** A long answer comes back as "working": continue until it is final. */
async function untilFinal(user: NovizUser, conversationId: string | undefined, answer: any) {
  while (answer.status === "working") {
    answer = await gateway(user, "POST", "/v1/chat/continue", { conversationId: conversationId || answer.conversationId, turnId: answer.turnId });
  }
  return answer;
}

/** The gateway's answer as an assistant message in your chat's message shape. */
function assistantMessage(answer: any) {
  return { id: answer.turnId, role: "assistant", content: answer.reply, html: answer.html, document: answer.document, createdAt: Date.now(), state: "done" };
}

function sendPdf(pdf: Awaited<ReturnType<typeof gatewayRaw>>, fallbackName: string) {
  return pdf.arrayBuffer().then((bytes) => new Response(bytes, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": pdf.headers.get("content-disposition") || `attachment; filename="${fallbackName}"` },
  }));
}

function notSignedIn() {
  return NextResponse.json({ error: "Not signed in, or no ERPNext access set up" }, { status: 401 });
}

/** Runs a route as the signed-in user; the gateway's refusals go back as they are. */
async function withUser(handler: (user: NovizUser) => Promise<Response>) {
  const user = await currentNovizUser();
  if (!user) return notSignedIn();
  try {
    return await handler(user);
  } catch (e) {
    if (e instanceof NovizError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}

// ============================================================================
// YOUR USER: the one function you replace
// ============================================================================
// Return the signed-in chat user and the ERPNext key you assigned to them,
// from your existing session and your own key store. Return null when no one
// is signed in.
//
// TEST SITE ONLY: here they come from .env
//   TEST_CHAT_USER=noviz-test
//   TEST_ERP_API_KEY=...
//   TEST_ERP_API_SECRET=...

async function currentNovizUser(): Promise<NovizUser | null> {
  const chatUser = process.env.TEST_CHAT_USER;
  const erpApiKey = process.env.TEST_ERP_API_KEY;
  const erpApiSecret = process.env.TEST_ERP_API_SECRET;
  return chatUser && erpApiKey && erpApiSecret ? { chatUser, erpApiKey, erpApiSecret } : null;
}
