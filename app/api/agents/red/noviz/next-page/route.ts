/** "Show me more" under a Noviz AI result: POST { tool, args, conversationId }. */
import { NextResponse } from "next/server";
import { novizNextPage, NovizError } from "@/lib/noviz/gateway";
import { currentNovizUser } from "@/lib/currentUser"; // yours: your session + the key you assigned

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await currentNovizUser();
  if (!user) return NextResponse.json({ error: "Not signed in, or no ERPNext access set up" }, { status: 401 });
  const { tool, args, conversationId } = await request.json();
  if (typeof tool !== "string" || !tool) return NextResponse.json({ error: "tool is required" }, { status: 400 });
  try {
    const answer = await novizNextPage(user, tool, args || {}, conversationId);
    return NextResponse.json({ message: { id: answer.turnId, role: "assistant", content: answer.reply, html: answer.html, document: answer.document, createdAt: Date.now(), state: "done" } });
  } catch (e) {
    if (e instanceof NovizError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
