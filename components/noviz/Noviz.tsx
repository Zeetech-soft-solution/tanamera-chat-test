"use client";
/**
 * ============================================================================
 * Noviz AI in your chat page: everything the browser needs, in ONE file
 * ============================================================================
 *
 *   1. readNovizEvents()  reads the stream from POST /api/agents/red/noviz/stream
 *   2. <NovizSteps>       "Working… 3.1s", then "Worked 9.4s · 5 steps ▾" above the reply
 *   3. <NovizAnswer>      Noviz AI's tables, cards and charts under the reply text
 *
 * Under an assistant message in your chat page:
 *
 *   <NovizSteps steps={message.steps} startedAt={message.startedAt} endedAt={message.endedAt} />
 *   <YourMarkdown>{message.content}</YourMarkdown>
 *   {message.html && (
 *     <NovizAnswer html={message.html}
 *                  onAsk={(text, hidden) => send(text, { hidden })}
 *                  onNextPage={(tool, args) => nextPage(tool, args)}
 *                  erpBaseUrl={ERP_URL} />
 *   )}
 *
 * Styles: noviz-chat.css (Noviz AI's own, never change) and noviz.css (your
 * colours). A full working page that uses all three: app/page.tsx.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import "./noviz-chat.css";
import "./noviz.css";

// ============================================================================
// 1. readNovizEvents: read the stream as it arrives
// ============================================================================
// The stream route answers Server-Sent Events. Call onEvent(name, data) for
// each one:
//   step    { id, label, status: "running" | "done" | "error", ms }
//   answer  { conversationId, turnId, reply, html, document }
//   error   { error: { code, message } }
//
//   const res = await fetch("/api/agents/red/noviz/stream", { method: "POST", body: ... });
//   await readNovizEvents(res.body, (event, data) => { ... });

export async function readNovizEvents(body: ReadableStream<Uint8Array>, onEvent: (event: string, data: any) => void) {
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

// ============================================================================
// 2. <NovizSteps>: the steps Noviz AI took for one answer
// ============================================================================
// "Working… 3.1s" with the current step while it runs, then "Worked 9.4s ·
// 5 steps", folded; click to see each step (what it did, done or refused, how
// long). Fill `steps` from the stream's `step` events: a step's later event
// replaces its earlier one (same id). Leave endedAt undefined while it works.

export type NovizStep = { id: number; label: string; status: "running" | "done" | "error"; ms?: number };

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function NovizSteps({ steps, startedAt, endedAt }: { steps: NovizStep[]; startedAt: number; endedAt?: number }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const working = endedAt === undefined;

  // The timer ticks only while Noviz AI works.
  useEffect(() => {
    if (!working) return;
    const tick = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(tick);
  }, [working]);

  const elapsed = (endedAt ?? now) - startedAt;
  const current = [...steps].reverse().find((s) => s.status === "running");

  return (
    <div className="nz-steps">
      <button type="button" className="nz-steps-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={working ? "nz-steps-spin" : "nz-steps-check"} aria-hidden />
        <span>{working ? `Working… ${seconds(elapsed)}` : `Worked ${seconds(elapsed)}`}</span>
        {steps.length > 0 && <span className="nz-steps-count">· {steps.length} {steps.length === 1 ? "step" : "steps"} {open ? "▴" : "▾"}</span>}
      </button>
      {working && !open && current && <div className="nz-steps-now">{current.label}…</div>}
      {open && (
        <ol className="nz-steps-list">
          {steps.map((s) => (
            <li key={s.id} className={`nz-step nz-step-${s.status}`}>
              <span className="nz-step-mark" aria-hidden>{s.status === "running" ? "" : s.status === "done" ? "✓" : "!"}</span>
              <span className="nz-step-label">
                {s.label}
                <small>{s.status === "running" ? (working ? "Running" : "Stopped") : s.status === "done" ? "Done" : "ERPNext refused"}</small>
              </span>
              {s.ms !== undefined && <span className="nz-step-ms">{seconds(s.ms)}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ============================================================================
// 3. <NovizAnswer>: Noviz AI's rendered result inside your assistant message
// ============================================================================
// - html:             the answer's `html` (Noviz AI's own result for this user's question)
// - onAsk:            a record ID or a suggested next step was clicked; send its
//                     question as the next chat message (hidden: don't show it as the user's)
// - onNextPage:       "Show me more"; POST /api/agents/red/noviz/next-page
// - pdfRoute:         your route that returns a report's PDF
// - documentPdfRoute: your route that returns one document's PDF
// - erpBaseUrl:       other ERPNext links in results open there (empty hides them)

// The relay's "Download PDF" links: a report (its spec rides in the query
// string) and one document (doctype + name in the query string).
const NOVIZ_PDF_PATH = "/api/method/noviz_ai.api.generate_report_pdf";
const DOCUMENT_PDF_PATH = "/api/method/frappe.utils.print_format.download_pdf";

// Charts carry a few fixed light colours; mapped to the dark style.
const DARK: Record<string, string> = {
  "#1B1E1C": "#e8e8e8", "#6B7268": "#c4c4c4", "#9BA098": "#9a9a9a",
  "#F5F6F3": "#3a3a3a", "#FFFFFF": "#2a2a2a", "#E3E4DF": "#333333",
};

export function NovizAnswer(props: {
  html: string;
  onAsk: (text: string, hidden: boolean) => void;
  onNextPage: (tool: string, args: Record<string, unknown>) => void;
  pdfRoute?: string;
  documentPdfRoute?: string;
  erpBaseUrl?: string;
}) {
  const { html, onAsk, onNextPage, pdfRoute = "/api/agents/red/noviz/pdf", documentPdfRoute = "/api/agents/red/noviz/pdf/document", erpBaseUrl = "" } = props;
  const ref = useRef<HTMLDivElement>(null);
  const themed = useMemo(() => html.replace(/#1B1E1C|#6B7268|#9BA098|#F5F6F3|#FFFFFF|#E3E4DF/gi, (c) => DARK[c.toUpperCase()]), [html]);

  // "Download PDF" goes to your own routes (the gateway gets the PDF); other
  // ERPNext paths ("/api/method/...") open on your ERPNext, or are hidden.
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLAnchorElement>('a[href^="/"]').forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (href.startsWith(NOVIZ_PDF_PATH)) {
        a.href = pdfRoute + href.slice(NOVIZ_PDF_PATH.length);
        a.removeAttribute("target");
      } else if (href.startsWith(DOCUMENT_PDF_PATH)) {
        a.href = documentPdfRoute + href.slice(DOCUMENT_PDF_PATH.length);
        a.removeAttribute("target");
      } else if (erpBaseUrl) {
        a.href = erpBaseUrl + a.getAttribute("href");
        a.target = "_blank";
        a.rel = "noopener";
      } else a.remove();
    });
  }, [themed, erpBaseUrl, pdfRoute, documentPdfRoute]);

  // Clicks inside the result: "Show me more", record IDs and next steps.
  function onClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    const more = target.closest<HTMLElement>(".erp-agent-next-page[data-query]");
    if (more) {
      e.preventDefault();
      try {
        const q = JSON.parse(more.dataset.query || "{}");
        return onNextPage(q.tool, q.args || {});
      } catch {
        return onAsk(more.dataset.action || "Show me more", true);
      }
    }
    const step = target.closest<HTMLElement>("button[data-action]");
    if (step) {
      e.preventDefault();
      onAsk(step.dataset.action || "", step.dataset.hidden === "1");
    }
  }

  return <div ref={ref} className="nz-root nz-result" onClick={onClick} dangerouslySetInnerHTML={{ __html: themed }} />;
}
