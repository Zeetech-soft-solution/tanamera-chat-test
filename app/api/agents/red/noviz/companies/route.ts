/**
 * The chat's company selection: GET -> { companies, selected }. The companies
 * this user may work in (ERPNext's own permissions) and the one the chat
 * starts in. Send the selected one back as `company` with every question.
 */
import { NextResponse } from "next/server";
import { novizCompanies, NovizError } from "@/lib/noviz/gateway";
import { currentNovizUser } from "@/lib/currentUser"; // yours: your session + the key you assigned

export const runtime = "nodejs";

export async function GET() {
  const user = await currentNovizUser();
  if (!user) return NextResponse.json({ error: "Not signed in, or no ERPNext access set up" }, { status: 401 });
  try {
    return NextResponse.json(await novizCompanies(user));
  } catch (e) {
    if (e instanceof NovizError) return NextResponse.json({ companies: [], selected: "" });
    throw e;
  }
}
