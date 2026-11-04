"use client";
/**
 * Noviz AI's rendered result (tables, cards, charts, next steps) inside your
 * chat's assistant message. Put it under the message text your chat already
 * renders (message.content is markdown):
 *
 *   <YourMarkdown>{message.content}</YourMarkdown>
 *   {message.html && (
 *     <NovizAnswer
 *       html={message.html}
 *       onAsk={(text, hidden) => sendToNoviz(text, { hidden })}
 *       onNextPage={(tool, args) => showNextPage(tool, args)}
 *     />
 *   )}
 *
 * - onAsk: a record ID or a suggested next step was clicked; send its
 *   question as the next chat message (hidden: do not show it as the user's).
 * - onNextPage: "Show me more"; POST /api/agents/red/noviz/next-page.
 * - pdfRoute: your route that returns a report's PDF (app/api/agents/red/noviz/pdf).
 * - documentPdfRoute: your route that returns one document's PDF
 *   (app/api/agents/red/noviz/pdf/document).
 * - erpBaseUrl: other ERPNext links in results open there (empty hides them).
 */
import { useEffect, useMemo, useRef } from "react";
import "./noviz-chat.css";
import "./noviz-answer.css";

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

  // The html is Noviz AI's own rendered result for this user's question.
  return <div ref={ref} className="nz-root nz-result" onClick={onClick} dangerouslySetInnerHTML={{ __html: themed }} />;
}
