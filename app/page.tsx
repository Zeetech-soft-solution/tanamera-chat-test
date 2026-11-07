"use client";
/**
 * The test chat: a full working page using Noviz AI. In Tanamera's chat, the
 * same calls come from your own chat page:
 *   - a question: POST /api/agents/red/noviz/stream { message, conversationId },
 *     read with readNovizEvents(); <NovizSteps> while it works
 *   - <NovizAnswer> under each assistant message that has `html`
 *   - "Show me more": POST /api/agents/red/noviz/next-page
 *   - the + menu: GET /api/agents/red/noviz/menu
 */
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { NovizAnswer, NovizStep, NovizSteps, readNovizEvents } from "@/components/noviz/Noviz";

type Message = {
  id: string; role: "user" | "assistant"; content: string; html?: string; error?: boolean; pending?: boolean;
  steps?: NovizStep[]; startedAt?: number; endedAt?: number;
};

const ERP_BASE_URL = process.env.NEXT_PUBLIC_ERP_BASE_URL || "";

// The reply text is markdown (bold, lists, tables): render it with a markdown library.
function Markdown({ text }: { text: string }) {
  return <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>;
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

  // A question: streamed, so the steps show while Noviz AI works.
  async function ask(text: string, hidden = false) {
    if (busy) return;
    setBusy(true);
    const id = crypto.randomUUID();
    const startedAt = Date.now();
    const update = (change: (m: Message) => Message) => setMessages((all) => all.map((x) => (x.id === id ? change(x) : x)));
    setMessages((m) => [...m, ...(hidden ? [] : [{ id: crypto.randomUUID(), role: "user" as const, content: text }]), { id, role: "assistant", content: "", pending: true, steps: [], startedAt }]);
    try {
      const res = await fetch("/api/agents/red/noviz/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, conversationId }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
      let answered = false;
      await readNovizEvents(res.body, (event, data) => {
        if (event === "step") update((m) => ({ ...m, steps: [...(m.steps || []).filter((s) => s.id !== data.id), data].sort((a, b) => a.id - b.id) }));
        if (event === "answer") {
          answered = true;
          if (data.conversationId) setConversationId(data.conversationId);
          update((m) => ({ ...m, pending: false, endedAt: Date.now(), content: data.reply, html: data.html }));
        }
        if (event === "error") {
          answered = true;
          update((m) => ({ ...m, pending: false, endedAt: Date.now(), error: true, content: data.error?.message || "Something went wrong." }));
        }
      });
      if (!answered) throw new Error("The answer stopped before it was complete. Please ask again.");
    } catch (e) {
      update((m) => ({ ...m, pending: false, endedAt: Date.now(), error: true, content: (e as Error).message }));
    }
    setBusy(false);
  }
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
                {m.startedAt !== undefined && <NovizSteps steps={m.steps || []} startedAt={m.startedAt} endedAt={m.endedAt} />}
                {m.pending ? (m.content && <span className="thinking">{m.content}</span>) : m.error ? <span className="error">{m.content}</span> : <Markdown text={m.content} />}
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
