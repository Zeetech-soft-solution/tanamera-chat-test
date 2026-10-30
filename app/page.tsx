"use client";
/**
 * The test chat. In Tanamera's chat, the same calls come from your own chat
 * page: POST /api/agents/red/noviz { message, conversationId }, and
 * <NovizAnswer> under each assistant message that has `html`.
 */
import { useEffect, useRef, useState } from "react";
import { NovizAnswer } from "@/components/noviz/NovizAnswer";

type Message = { id: string; role: "user" | "assistant"; content: string; html?: string; error?: boolean; pending?: boolean };

const ERP_BASE_URL = process.env.NEXT_PUBLIC_ERP_BASE_URL || "";

// Minimal markdown for the reply text: bold, code, bullets, line breaks.
function Markdown({ text }: { text: string }) {
  const esc = text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = esc.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/^[-*] (.*)$/gm, "• $1").replace(/\n/g, "<br>");
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function ChatTest() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ id: string; label: string; prompt?: string; empty?: string }[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/agents/red/noviz/menu").then((r) => r.json()).then((d) => setMenu(d.items || [])).catch(() => {});
  }, []);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages]);

  async function run(path: string, body: object, userText: string | null) {
    if (busy) return;
    setBusy(true);
    const pendingId = crypto.randomUUID();
    setMessages((m) => [...m, ...(userText ? [{ id: crypto.randomUUID(), role: "user" as const, content: userText }] : []), { id: pendingId, role: "assistant", content: "Thinking…", pending: true }]);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      if (data.conversationId) setConversationId(data.conversationId);
      setMessages((m) => m.map((x) => (x.id === pendingId ? { ...data.message, role: "assistant" } : x)));
    } catch (e) {
      setMessages((m) => m.map((x) => (x.id === pendingId ? { id: pendingId, role: "assistant", content: (e as Error).message, error: true } : x)));
    }
    setBusy(false);
  }

  const ask = (text: string, hidden = false) => run("/api/agents/red/noviz", { message: text, conversationId }, hidden ? null : text);
  const nextPage = (tool: string, args: Record<string, unknown>) => run("/api/agents/red/noviz/next-page", { tool, args, conversationId }, null);

  return (
    <div className="chat">
      <header>
        <div className="avatar">✦</div>
        <div>
          <b>ERP Assistant</b>
          <span className="badge">Noviz AI</span>
        </div>
        <button className="new" onClick={() => { setMessages([]); setConversationId(undefined); }}>＋ New chat</button>
      </header>
      <div className="log" ref={log}>
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="row user"><div className="bubble-user">{m.content}</div></div>
          ) : (
            <div key={m.id} className="row">
              <div className="avatar">✦</div>
              <div className="bubble-ai">
                {m.pending ? <span className="thinking">{m.content}</span> : m.error ? <span className="error">{m.content}</span> : <Markdown text={m.content} />}
                {m.html && <NovizAnswer html={m.html} onAsk={ask} onNextPage={nextPage} erpBaseUrl={ERP_BASE_URL} />}
              </div>
            </div>
          ),
        )}
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); if (input.trim()) { ask(input.trim()); setInput(""); } }}>
        <button type="button" className="round" onClick={() => setMenuOpen(!menuOpen)}>＋</button>
        {menuOpen && (
          <div className="menu">
            {menu.map((it) => (
              <button key={it.id} type="button" onClick={() => { setMenuOpen(false); if (it.prompt) ask(it.prompt); }}>{it.label}</button>
            ))}
          </div>
        )}
        <textarea value={input} placeholder="Ask about your ERPNext…" onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
        <button className="round send" disabled={busy}>↑</button>
      </form>
    </div>
  );
}
