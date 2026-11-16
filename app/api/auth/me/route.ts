/** Who is logged in on this site: { user, fullName }, or 401. */
import { NextResponse } from "next/server";
import { signedInUser } from "@/lib/currentUser";

export const runtime = "nodejs";

export async function GET() {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  return NextResponse.json({ user: user.user, fullName: user.fullName });
}
