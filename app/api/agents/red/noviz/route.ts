/**
 * Noviz AI as one of your chat's agents, next to /api/agents/red/member-segments,
 * business-analysis and it-assistance. Same request your chat already sends:
 *   POST { message, conversationId }
 * Answers with an assistant message in your chat's own message shape, plus
 * Noviz AI's rendered result in `html`.
 */
import { NextResponse } from "next/server";
import { askNoviz, NovizError } from "@/lib/noviz/gateway";
import { currentNovizUser } from "@/lib/currentUser"; // yours: your session + the key you assigned

export const runtime = "nodejs";
export const maxDuration = 300; // a long answer continues on the server

export async function POST(request: Request) {
  const user = await currentNovizUser();
  if (!user) return NextResponse.json({ error: "Not signed in, or no ERPNext access set up" }, { status: 401 });

  const { message, conversationId } = await request.json();
  if (typeof message !== "string" || !message.trim()) return NextResponse.json({ error: "message is required" }, { status: 400 });

  try {
    const answer = await askNoviz(user, message.trim(), conversationId);
    return NextResponse.json({
      conversationId: answer.conversationId,
      message: {
        id: answer.turnId,
        role: "assistant",
        content: answer.reply,
        html: answer.html,
        activities: [],
        references: [],
        createdAt: Date.now(),
        state: "done",
      },
    });
  } catch (e) {
    if (e instanceof NovizError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
