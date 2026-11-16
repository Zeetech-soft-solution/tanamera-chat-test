/**
 * ============================================================================
 * Noviz AI: every chat route in ONE file
 * ============================================================================
 *
 * Noviz AI is one of your chat's agents, next to /api/agents/red/member-segments,
 * business-analysis and it-assistance. Copy this file into your Next.js app at
 * app/api/agents/red/noviz/route.ts and it answers all of these:
 *
 *   POST /api/agents/red/noviz                       1. Chat: { message, conversationId, company } -> the answer
 *   POST /api/agents/red/noviz?route=stream          2. Stream: the steps while it works, then the answer
 *   POST /api/agents/red/noviz?route=next-page       3. Show more: { tool, args, conversationId, company } -> next page
 *   GET  /api/agents/red/noviz?route=menu            4. Menu: the + menu items (Approvals, Mail, ...)
 *   GET  /api/agents/red/noviz?route=pdf             5. Report PDF: &spec=<the answer's report spec>
 *   GET  /api/agents/red/noviz?route=document-pdf    6. Document PDF: &doctype=&name=[&format=]
 *   GET  /api/agents/red/noviz?route=companies       7. Company selection: { companies, selected }
 *   POST /api/agents/red/noviz?route=login           8. Login: { usr, pwd } (ERPNext user name and password) -> the user's ERPNext session
 *   POST /api/agents/red/noviz?route=logout          9. Logout: ends the user's ERPNext session
 *
 * Company: a user works in one company at a time. Show route 7's companies as
 * a selection in your chat and send the selected one as `company` with routes
 * 1, 2 and 3; every answer is then for that company. When the user changes it,
 * start a new conversation.
 *
 * Login: the user logs in with their ERPNext user name and password (route 8);
 * ERPNext checks them and returns the user's session, kept here in an HttpOnly
 * cookie. Every other route runs as that user, with their ERPNext permissions.
 *
 * Server only: the Noviz AI tenant key and the user's ERPNext session never
 * reach the browser. Noviz AI stores no password and no session.
 *
 * The one thing you change: currentNovizUser() at the bottom of this file.
 *
 * Settings (.env):
 *   NOVIZ_GATEWAY_URL=https://tanamera-gateway.noviz.in
 *   NOVIZ_TENANT_KEY=tnt_...
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Agent, fetch } from "undici";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // a long answer continues on the server

// ----------------------------------------------------------------------------
// Routing: ?route= says which of the routes was called (none = chat)
// ----------------------------------------------------------------------------

const routeOf = (request: Request) => new URL(request.url).searchParams.get("route") || "";

export async function POST(request: Request) {
  const route = routeOf(request);
  if (route === "") return chat(request);
  if (route === "stream") return stream(request);
  if (route === "next-page") return nextPage(request);
  if (route === "login") return login(request);
  if (route === "logout") return logout();
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET(request: Request) {
  const route = routeOf(request);
  if (route === "menu") return menu();
  if (route === "pdf") return reportPdf(request);
  if (route === "document-pdf") return documentPdf(request);
  if (route === "companies") return companies();
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

// ----------------------------------------------------------------------------
// 1. Chat: POST { message, conversationId, company }
//    Answers with an assistant message in your chat's own message shape, plus
//    Noviz AI's rendered result (tables, cards, charts) in `html`.
// ----------------------------------------------------------------------------

async function chat(request: Request) {
  return withUser(async (user) => {
    const { message, conversationId, company } = await request.json();
    if (typeof message !== "string" || !message.trim()) return NextResponse.json({ error: "message is required" }, { status: 400 });

    let answer = await gateway(user, "POST", "/v1/chat", { message: message.trim(), conversationId, company, can_continue: true });
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
    const { message, conversationId, company } = await request.json();
    if (typeof message !== "string" || !message.trim()) return NextResponse.json({ error: "message is required" }, { status: 400 });

    const upstream = await gatewayRaw(user, "POST", "/v1/chat/stream", { message: message.trim(), conversationId, company });
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
    const { tool, args, conversationId, company } = await request.json();
    if (typeof tool !== "string" || !tool) return NextResponse.json({ error: "tool is required" }, { status: 400 });

    let answer = await gateway(user, "POST", "/v1/chat/next-page", { tool, args: args || {}, conversationId, company, can_continue: true });
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
// 7. Company selection: GET ?route=companies -> { companies, selected }
//    The companies this user may work in (ERPNext's own permissions) and the
//    one the chat starts in. One entry: show it as text, no selection needed.
// ----------------------------------------------------------------------------

async function companies() {
  const user = await currentNovizUser();
  if (!user) return notSignedIn();
  try {
    return NextResponse.json(await gateway(user, "GET", "/v1/chat/companies"));
  } catch (e) {
    if (e instanceof NovizError) return NextResponse.json({ companies: [], selected: "" });
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

// ----------------------------------------------------------------------------
// 8. Login: POST ?route=login { usr, pwd } -> { user, fullName }
//    The gateway logs in to ERPNext (POST /api/method/login) and returns the
//    user's session; it is kept in an HttpOnly cookie until ERPNext ends it.
//    A wrong password answers 401 with ERPNext's own message.
// ----------------------------------------------------------------------------

async function login(request: Request) {
  const { usr, pwd } = await request.json().catch(() => ({}));
  if (typeof usr !== "string" || !usr.trim() || typeof pwd !== "string" || !pwd) {
    return NextResponse.json({ error: "Enter your ERPNext user name and password." }, { status: 400 });
  }
  const response = await fetch(`${GATEWAY_URL}/v1/auth/login`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TENANT_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ usr: usr.trim(), pwd }),
    dispatcher: connection,
  });
  const session: any = await response.json().catch(() => ({}));
  if (!response.ok) return NextResponse.json({ error: session.error?.message || "Login failed", code: session.error?.code }, { status: response.status });
  const out = NextResponse.json({ user: session.user, fullName: session.fullName });
  out.cookies.set({
    name: SESSION_COOKIE,
    value: Buffer.from(JSON.stringify({ sessionId: session.sessionId, user: session.user })).toString("base64url"),
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    ...(session.expiresAt ? { expires: new Date(session.expiresAt) } : {}),
  });
  return out;
}

// ----------------------------------------------------------------------------
// 9. Logout: POST ?route=logout -> { ok: true }
//    Ends the session in ERPNext and removes the cookie.
// ----------------------------------------------------------------------------

async function logout() {
  const user = await currentNovizUser();
  if (user) {
    await fetch(`${GATEWAY_URL}/v1/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TENANT_KEY}`, "X-ERP-Session": user.erpSessionId },
      dispatcher: connection,
    }).then((r) => r.arrayBuffer()).catch(() => undefined);
  }
  const out = NextResponse.json({ ok: true });
  out.cookies.delete(SESSION_COOKIE);
  return out;
}

// ============================================================================
// The gateway call (you change nothing below, except currentNovizUser)
// ============================================================================

const GATEWAY_URL = process.env.NOVIZ_GATEWAY_URL!;
const TENANT_KEY = process.env.NOVIZ_TENANT_KEY!;

/** Who is chatting: your chat's user and the session of their ERPNext login (route 8). */
interface NovizUser {
  chatUser: string; // your chat's user id
  erpSessionId: string; // the sessionId the login returned
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
      "X-ERP-Session": user.erpSessionId,
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
// Return the signed-in chat user and the ERPNext session of their login.
// Here: the cookie route 8 sets. With your own login, call route 8's gateway
// login when the user logs in, keep sessionId in your session and return it.
// Return null when no one is signed in.

const SESSION_COOKIE = "noviz_erp_session";

async function currentNovizUser(): Promise<NovizUser | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;
  try {
    const s = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return typeof s.sessionId === "string" && typeof s.user === "string" ? { chatUser: s.user, erpSessionId: s.sessionId } : null;
  } catch {
    return null;
  }
}
