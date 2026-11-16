/** Home after login: the menu. */
import Link from "next/link";
import { AppNav } from "@/components/AppNav";
import { signedInUser } from "@/lib/currentUser";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await signedInUser();
  return (
    <div className="app">
      <AppNav />
      <main className="home">
        <h1>Welcome{user ? `, ${user.fullName}` : ""}</h1>
        <p className="muted">Logged in to ERPNext as {user?.user}. Noviz AI answers with your own ERPNext permissions.</p>
        <div className="cards">
          <Link href="/chat" className="card">
            <b>Chat</b>
            <span>Ask about your ERPNext: sales, stock, approvals, reports.</span>
          </Link>
        </div>
      </main>
    </div>
  );
}
