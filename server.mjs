// Small local chat page: Noviz AI relay <-> ERPNext over the REST API.
// It does what the noviz_ai plugin's dispatcher does, with an API key
// instead of a logged-in Desk session: start a turn, run each fetch step
// against ERPNext as the key's user, post the result back, print the reply.
// Settings come from .env next to this file (see .env.example).

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// ---- Settings: fill in here, or leave empty and set them in .env ----
// For now the keys are plain variables. In production read them from your
// own database or secrets store per logged-in user (one ERPNext key or
// OAuth token per person) instead of hard-coding them here. Never commit
// real values; .env is git-ignored.
const CONFIG = {
  NOVIZ_RELAY_URL: "https://noviz.in/platform-api",
  NOVIZ_TENANT_KEY: "", // Noviz AI tenant key (tnt_...), one per company
  ERP_URL: "", // e.g. https://your-erpnext.example.com
  ERP_API_KEY: "", // ERPNext User > Settings > API Access > Generate Keys
  ERP_API_SECRET: "", // shown once when generated; ERPNext stores it encrypted
  // Login for the chat page. Required when HOST is not 127.0.0.1.
  CHAT_USER: "",
  CHAT_PASSWORD: "",
  HOST: "127.0.0.1", // 0.0.0.0 to serve other machines (put HTTPS in front)
  PORT: 5055,
};
const setting = (name) => process.env[name] || CONFIG[name];

const RELAY = String(setting("NOVIZ_RELAY_URL")).replace(/\/$/, "");
const TENANT_KEY = setting("NOVIZ_TENANT_KEY");
const ERP = String(setting("ERP_URL") || "").replace(/\/$/, "");
const ERP_AUTH = `token ${setting("ERP_API_KEY")}:${setting("ERP_API_SECRET")}`;
const HOST = setting("HOST");
const LOGIN = setting("CHAT_USER") && setting("CHAT_PASSWORD") ? "Basic " + Buffer.from(`${setting("CHAT_USER")}:${setting("CHAT_PASSWORD")}`).toString("base64") : null;

if (HOST !== "127.0.0.1" && HOST !== "localhost" && !LOGIN) {
  console.error(`HOST is ${HOST}: set CHAT_USER and CHAT_PASSWORD so the page is not open to everyone`);
  process.exit(1);
}

for (const [name, value] of Object.entries({ NOVIZ_TENANT_KEY: TENANT_KEY, ERP_URL: ERP, ERP_API_KEY: setting("ERP_API_KEY"), ERP_API_SECRET: setting("ERP_API_SECRET") })) {
  if (!value) {
    console.error(`Missing ${name} (set it in .env)`);
    process.exit(1);
  }
}

// ---- ERPNext REST calls, always as the API key's own user ----

function erpError(body, status) {
  // Frappe puts the readable message in _server_messages (JSON list of JSON
  // strings) or exception; pass ERPNext's own words back to the relay.
  try {
    const msgs = JSON.parse(body._server_messages || "[]").map((m) => JSON.parse(m).message).filter(Boolean);
    if (msgs.length) return msgs.join(" ").replace(/<[^>]+>/g, "");
  } catch {}
  return (body.exception || body.message || `ERPNext returned HTTP ${status}`).toString().replace(/<[^>]+>/g, "");
}

async function erp(method, urlPath, { query, body } = {}) {
  const url = new URL(ERP + urlPath);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const res = await fetch(url, {
    method,
    headers: { Authorization: ERP_AUTH, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { message: text.slice(0, 300) }; }
  if (!res.ok) throw new Error(erpError(json, res.status));
  return json;
}

const resource = (doctype, name) => `/api/resource/${encodeURIComponent(doctype)}${name ? "/" + encodeURIComponent(name) : ""}`;

function normalizeReport(message) {
  // Same as the plugin: dict rows only, or zip list rows with the columns.
  const result = message?.result;
  if (!Array.isArray(result)) return [];
  if (result.some((r) => r && !Array.isArray(r) && typeof r === "object")) return result.filter((r) => r && !Array.isArray(r) && typeof r === "object");
  const cols = (message.columns || []).map((c) => (typeof c === "string" ? c.split(":")[0] : c.fieldname || c.label));
  return result.filter(Array.isArray).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

async function runCallSpec(spec) {
  const { kind, doctype } = spec;
  switch (kind) {
    case "get_list":
      return (await erp("GET", resource(doctype), {
        query: {
          fields: spec.fields?.length ? spec.fields : ["name"],
          filters: spec.filters,
          order_by: spec.order_by,
          limit_page_length: spec.limit || 20,
          limit_start: spec.start || 0,
        },
      })).data;
    case "get_doc": {
      const full = (await erp("GET", resource(doctype, spec.name))).data;
      return spec.fields?.length ? Object.fromEntries(spec.fields.map((f) => [f, full[f]])) : full;
    }
    case "create_doc":
      return (await erp("POST", resource(doctype), { body: spec.values })).data;
    case "update_doc":
      return (await erp("PUT", resource(doctype, spec.name), { body: spec.values })).data;
    case "run_report":
      return normalizeReport((await erp("GET", "/api/method/frappe.desk.query_report.run", {
        query: { report_name: spec.reportName, filters: spec.reportFilters || {} },
      })).message);
    case "mark_notification_read":
      await erp("POST", "/api/method/frappe.desk.doctype.notification_log.notification_log.mark_as_read", { body: { docname: spec.name } });
      return { ok: true, id: spec.name };
    default:
      return { error: `This test chat cannot run "${kind}" calls.` };
  }
}

// ---- Relay ----

async function relay(urlPath, body) {
  const res = await fetch(RELAY + urlPath, {
    method: "POST",
    headers: { Authorization: `Bearer ${TENANT_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Relay returned HTTP ${res.status}`);
  return json;
}

async function whoAmI() {
  const user = (await erp("GET", "/api/method/frappe.auth.get_logged_user")).message;
  let roles = [];
  try {
    roles = ((await erp("GET", resource("User", user))).data.roles || []).map((r) => r.role);
  } catch {}
  return { user, roles };
}

async function ask(prompt, me, previousTurnId, onStep) {
  let step = await relay("/v1/agent/turn", {
    prompt,
    erp_user: me.user,
    erp_roles: me.roles,
    ...(previousTurnId ? { previous_turn_id: previousTurnId } : {}),
  });
  while (step.status === "fetch") {
    const spec = step.request;
    onStep(spec);
    let result;
    try {
      result = await runCallSpec(spec);
    } catch (e) {
      result = { error: e.message };
    }
    step = await relay("/v1/agent/turn/continue", { turnId: step.turnId, result });
  }
  return step;
}

// ---- Local web server: serves chat.html and runs each question ----

const me = await whoAmI();
const PORT = Number(setting("PORT"));

http.createServer(async (req, res) => {
  if (LOGIN && req.headers.authorization !== LOGIN) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Noviz AI chat"' });
    return res.end("Login required");
  }
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(fs.readFileSync(path.join(here, "chat.html")));
  }
  if (req.method === "GET" && req.url === "/me") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ user: me.user, erp: ERP }));
  }
  if (req.method === "POST" && req.url === "/ask") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const { prompt, previousTurnId } = JSON.parse(raw || "{}");
    const steps = [];
    try {
      const final = await ask(prompt, me, previousTurnId, (spec) => steps.push(`${spec.kind} ${spec.doctype || spec.reportName || ""}`.trim()));
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ reply: final.reply, html: final.html, turnId: final.turnId, steps }));
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: e.message, steps }));
    }
  }
  res.writeHead(404).end();
}).listen(PORT, HOST, () => {
  console.log(`ERPNext: ${ERP} as ${me.user} (${me.roles.length} roles)`);
  console.log(`Relay:   ${RELAY}`);
  console.log(`Chat:    http://localhost:${PORT}`);
});
