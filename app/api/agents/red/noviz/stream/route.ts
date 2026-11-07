/**
 * Noviz AI as one of your chat's agents, answered as a stream:
 *   POST { message, conversationId }  ->  text/event-stream
 * The gateway's events pass through as they are: `step` while Noviz AI works,
 * then `answer` (conversationId, turnId, reply, html, document) or `error`.
 * The browser reads them with fetch + getReader (see app/page.tsx).
 */
import { NextResponse } from "next/server";
import { NovizError, streamNoviz } from "@/lib/noviz/gateway";
import { currentNovizUser } from "@/lib/currentUser"; // yours: your session + the key you assigned

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await currentNovizUser();
  if (!user) return NextResponse.json({ error: "Not signed in, or no ERPNext access set up" }, { status: 401 });

  const { message, conversationId } = await request.json();
  if (typeof message !== "string" || !message.trim()) return NextResponse.json({ error: "message is required" }, { status: 400 });

  try {
    const upstream = await streamNoviz(user, message.trim(), conversationId);
    return new Response(upstream.body as unknown as ReadableStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        // next start compresses responses, which holds events back; a stream is sent as it is.
        "Content-Encoding": "none",
      },
    });
  } catch (e) {
    if (e instanceof NovizError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
