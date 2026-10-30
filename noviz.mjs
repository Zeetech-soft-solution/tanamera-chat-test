// Noviz AI for ERPNext: the calling code to plug into your own chat.
//
//   import { askNoviz } from "./noviz.mjs";
//   const answer = await askNoviz("how many customers do we have?");
//   // answer.reply (markdown text), answer.html (table/chart, optional),
//   // answer.turnId (pass back as previousTurnId to continue the conversation)
//
// How it works: the relay either answers or asks for one ERPNext call. This
// code runs that call with the ERPNext API key and sends the result back,
// until the relay gives the final answer. Every call runs as the user who
// owns the key, so ERPNext applies that user's own roles and permissions.
// Run this on your server only; never ship the keys to a browser.

// ---- Settings ----
// For now the keys are plain variables. In production read them from your
// own database or secrets store per logged-in user (one ERPNext key or
// OAuth token per person). Never commit real values.
const NOVIZ_RELAY_URL = "https://noviz.in/platform-api";
const NOVIZ_TENANT_KEY = ""; // Noviz AI tenant key (tnt_...), one per company
const ERP_URL = ""; // e.g. https://your-erpnext.example.com
const ERP_API_KEY = ""; // ERPNext User > Settings > API Access > Generate Keys
const ERP_API_SECRET = ""; // shown once when generated; ERPNext stores it encrypted

// ---- ERPNext REST calls (as the API key's user) ----

async function erp(method, path, { query, body } = {}) {
  const url = new URL(ERP_URL + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `token ${ERP_API_KEY}:${ERP_API_SECRET}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Pass ERPNext's own message back so the AI can tell the user.
    let msg = json.exception || `ERPNext returned HTTP ${res.status}`;
    try { msg = JSON.parse(json._server_messages).map((m) => JSON.parse(m).message).join(" ") || msg; } catch {}
    throw new Error(String(msg).replace(/<[^>]+>/g, ""));
  }
  return json;
}

const resource = (doctype, name) => `/api/resource/${encodeURIComponent(doctype)}${name ? "/" + encodeURIComponent(name) : ""}`;

// One relay request -> one ERPNext call.
async function runCall(spec) {
  switch (spec.kind) {
    case "get_list":
      return (await erp("GET", resource(spec.doctype), {
        query: { fields: spec.fields?.length ? spec.fields : ["name"], filters: spec.filters, order_by: spec.order_by, limit_page_length: spec.limit || 20, limit_start: spec.start || 0 },
      })).data;
    case "get_doc": {
      const doc = (await erp("GET", resource(spec.doctype, spec.name))).data;
      return spec.fields?.length ? Object.fromEntries(spec.fields.map((f) => [f, doc[f]])) : doc;
    }
    case "create_doc":
      return (await erp("POST", resource(spec.doctype), { body: spec.values })).data;
    case "update_doc":
      return (await erp("PUT", resource(spec.doctype, spec.name), { body: spec.values })).data;
    case "run_report": {
      const m = (await erp("GET", "/api/method/frappe.desk.query_report.run", { query: { report_name: spec.reportName, filters: spec.reportFilters || {} } })).message || {};
      const cols = (m.columns || []).map((c) => (typeof c === "string" ? c.split(":")[0] : c.fieldname));
      return (m.result || []).map((r) => (Array.isArray(r) ? Object.fromEntries(cols.map((c, i) => [c, r[i]])) : r)).filter((r) => r && typeof r === "object");
    }
    default:
      return { error: `This integration does not run "${spec.kind}" calls.` };
  }
}

// ---- Relay ----

async function relay(path, body) {
  const res = await fetch(NOVIZ_RELAY_URL + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${NOVIZ_TENANT_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Relay returned HTTP ${res.status}`);
  return json;
}

let me; // the ERPNext user behind the key, looked up once
async function whoAmI() {
  if (!me) {
    const user = (await erp("GET", "/api/method/frappe.auth.get_logged_user")).message;
    const roles = ((await erp("GET", resource("User", user)).catch(() => ({ data: {} }))).data.roles || []).map((r) => r.role);
    me = { user, roles };
  }
  return me;
}

export async function askNoviz(prompt, previousTurnId) {
  const { user, roles } = await whoAmI();
  let step = await relay("/v1/agent/turn", { prompt, erp_user: user, erp_roles: roles, ...(previousTurnId ? { previous_turn_id: previousTurnId } : {}) });
  while (step.status === "fetch") {
    let result;
    try { result = await runCall(step.request); } catch (e) { result = { error: e.message }; }
    step = await relay("/v1/agent/turn/continue", { turnId: step.turnId, result });
  }
  return { reply: step.reply, html: step.html, turnId: step.turnId };
}
