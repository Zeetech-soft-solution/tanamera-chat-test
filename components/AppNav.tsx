"use client";
/** The site's menu: Home, Chat, the logged-in user and Logout. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function AppNav() {
  const path = usePathname();
  const [name, setName] = useState("");
  useEffect(() => {
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((me) => me && setName(me.fullName || me.user)).catch(() => {});
  }, []);
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }
  return (
    <nav className="appnav">
      <span className="brand">Tanamera · Noviz AI</span>
      <Link href="/" className={path === "/" ? "on" : ""}>Home</Link>
      <Link href="/chat" className={path === "/chat" ? "on" : ""}>Chat</Link>
      <span className="who">{name}</span>
      <button type="button" onClick={logout}>Logout</button>
    </nav>
  );
}
