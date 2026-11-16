"use client";
/** Login with the ERPNext user name and password; ERPNext checks them. */
import { useState } from "react";

export default function Login() {
  const [usr, setUsr] = useState("");
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usr, pwd }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      window.location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form onSubmit={submit}>
        <div className="avatar">✦</div>
        <h1>Tanamera · Noviz AI</h1>
        <p className="muted">Log in with your ERPNext account.</p>
        <label>
          User name or email
          <input value={usr} onChange={(e) => setUsr(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label>
          Password
          <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>{busy ? "Logging in…" : "Login"}</button>
      </form>
    </main>
  );
}
