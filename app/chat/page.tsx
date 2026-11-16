"use client";
/**
 * The test chat. In Tanamera's chat, the same calls come from your own chat
 * page: POST /api/agents/red/noviz/stream { message, conversationId, company }
 * (read as a stream: <NovizSteps> while it works), and <NovizAnswer> under each
 * assistant message that has `html`.
 *
 * Company: GET /api/agents/red/noviz/companies gives the companies the user may
 * work in and the one to start in. The header shows them as a selection; the
 * selected one goes with every question and next page, so every answer is for
 * that company. One company at a time. Changing it starts a new chat.
 */
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { NovizAnswer } from "@/components/noviz/NovizAnswer";
import { NovizStep, NovizSteps } from "@/components/noviz/NovizSteps";
import { AppNav } from "@/components/AppNav";

/** The ERPNext session has ended (ERPNext's answer, or no login): log in again. */
function loginAgain(res: Response) {
  if (res.status !== 401) return false;
  window.location.href = "/login";
  return true;
}

type Message = {
  id: string; role: "user" | "assistant"; content: string; html?: string; error?: boolean; pending?: boolean;
  steps?: NovizStep[]; startedAt?: number; endedAt?: number;
};

/** Reads a Server-Sent Events body as it arrives: onEvent(name, data) per event. */
async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (event: string, data: any) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (data) onEvent(event, JSON.parse(data)); // lines starting with ":" only keep the stream open
    }
  }
}

const ERP_BASE_URL = process.env.NEXT_PUBLIC_ERP_BASE_URL || "";
// Where this browser remembers the company chosen last time.
const COMPANY_KEY = "noviz_company";

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
  // The company the chat works in, from the companies this user may work in.
  const [companies, setCompanies] = useState<string[]>([]);
  const [company, setCompany] = useState<string | undefined>();
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/agents/red/noviz/menu").then((r) => r.json()).then((d) => setMenu(d.items || [])).catch(() => {});
    fetch("/api/agents/red/noviz/companies").then((r) => r.json()).then((d) => {
      const list: string[] = Array.isArray(d.companies) ? d.companies : [];
      setCompanies(list);
      // The one chosen last time on this browser, when still allowed; else the user's default.
      const remembered = window.localStorage.getItem(COMPANY_KEY);
      setCompany(remembered && list.includes(remembered) ? remembered : d.selected || undefined);
    }).catch(() => {});
  }, []);
  function chooseCompany(name: string) {
    setCompany(name);
    window.localStorage.setItem(COMPANY_KEY, name);
    // The earlier answers were for the other company: a new chat.
    setMessages([]);
    setConversationId(undefined);
  }
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
      if (loginAgain(res)) return;
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
      const res = await fetch("/api/agents/red/noviz/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, conversationId, company }) });
      if (loginAgain(res)) return;
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
      let answered = false;
      await readEvents(res.body, (event, data) => {
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
  const nextPage = (tool: string, args: Record<string, unknown>) => run("/api/agents/red/noviz/next-page", { tool, args, conversationId, company }, null);

  return (
    <div className="app">
    <AppNav />
    <div className="chat">
      <header>
        <div className="avatar">✦</div>
        <div>
          <b>ERP Assistant</b>
          <span className="badge">Noviz AI</span>
          {companies.length > 1 ? (
            <select className="company" aria-label="Company" value={company || ""} disabled={busy} onChange={(e) => chooseCompany(e.target.value)}>
              {companies.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          ) : company ? <span className="company">{company}</span> : null}
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
    </div>
  );
}
