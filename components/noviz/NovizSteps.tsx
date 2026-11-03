"use client";
/**
 * The steps Noviz AI took for one answer, above the reply: "Working… 3.1s"
 * while it runs, then "Worked 9.4s · 5 steps", folded; click to see each step
 * (what it did, done or refused, how long). Fill `steps` from the stream's
 * `step` events: a step's later event replaces its earlier one (same id).
 */
import { useEffect, useState } from "react";
import "./noviz-steps.css";

export type NovizStep = { id: number; label: string; status: "running" | "done" | "error"; ms?: number };

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function NovizSteps({ steps, startedAt, endedAt }: { steps: NovizStep[]; startedAt: number; endedAt?: number }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const working = endedAt === undefined;

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
