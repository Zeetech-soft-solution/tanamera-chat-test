/** "Download PDF" under a Noviz AI answer: GET ?spec=<the answer's report spec>. */
import { NextResponse } from "next/server";
import { novizPdf, NovizError } from "@/lib/noviz/gateway";
import { currentNovizUser } from "@/lib/currentUser"; // yours: your session + the key you assigned

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const user = await currentNovizUser();
  if (!user) return NextResponse.json({ error: "Not signed in, or no ERPNext access set up" }, { status: 401 });
  const spec = new URL(request.url).searchParams.get("spec");
  if (!spec) return NextResponse.json({ error: "spec is required" }, { status: 400 });
  try {
    const pdf = await novizPdf(user, spec);
    return new Response(await pdf.arrayBuffer(), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": pdf.headers.get("content-disposition") || 'attachment; filename="report.pdf"' },
    });
  } catch (e) {
    if (e instanceof NovizError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
