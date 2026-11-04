/** "Download PDF" of one document under a Noviz AI answer: GET ?doctype=&name=. */
import { NextResponse } from "next/server";
import { novizDocumentPdf, NovizError } from "@/lib/noviz/gateway";
import { currentNovizUser } from "@/lib/currentUser"; // yours: your session + the key you assigned

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const user = await currentNovizUser();
  if (!user) return NextResponse.json({ error: "Not signed in, or no ERPNext access set up" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const doctype = params.get("doctype");
  const name = params.get("name");
  if (!doctype || !name) return NextResponse.json({ error: "doctype and name are required" }, { status: 400 });
  try {
    const pdf = await novizDocumentPdf(user, doctype, name, params.get("format") || undefined);
    return new Response(await pdf.arrayBuffer(), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": pdf.headers.get("content-disposition") || 'attachment; filename="document.pdf"' },
    });
  } catch (e) {
    if (e instanceof NovizError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
