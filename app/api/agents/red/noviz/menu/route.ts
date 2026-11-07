/** The + menu items Noviz AI offers for this ERP (Approvals, Mail, ...). */
import { NextResponse } from "next/server";
import { novizMenu, NovizError } from "@/lib/noviz/gateway";
import { currentNovizUser } from "@/lib/currentUser"; // yours: your session + the key you assigned

export const runtime = "nodejs";

export async function GET() {
  const user = await currentNovizUser();
  if (!user) return NextResponse.json({ error: "Not signed in, or no ERPNext access set up" }, { status: 401 });
  try {
    return NextResponse.json({ items: await novizMenu(user) });
  } catch (e) {
    if (e instanceof NovizError) return NextResponse.json({ items: [] });
    throw e;
  }
}
