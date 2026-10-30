// Noviz AI for ERPNext: the communication layer between your chat and the
// Noviz AI relay. Runs on your server only.
//
//   Your chat page ──> your server (this file) ──> Noviz AI relay (the AI)
//                            │  runs each ERPNext call the relay asks for
//                            └──> ERPNext REST API, with the user's API key
//
// The API key is the permission layer: every ERPNext call runs as the user
// who owns the key, so ERPNext applies that user's roles and permissions.
// The relay never touches ERPNext and never holds ERPNext keys.
//
// Exports:
//   askNoviz(prompt, previousTurnId)  -> the relay's final answer
//   nextPage(tool, args)              -> the next page of a list answer
//   chatMenu()                        -> the chat's + menu items

// ---- Settings ----
// Plain variables for now. In production read them per logged-in user from
// your database or secrets store. Never commit real values.
const NOVIZ_RELAY_URL = "https://noviz.in/platform-api";
const NOVIZ_TENANT_KEY = ""; // Noviz AI tenant key (tnt_...), one per company
const ERP_URL = ""; // e.g. https://your-erpnext.example.com

// ERPNext user the chat runs as. Keep ONE block active, comment the others.
// Each user's key: ERPNext > User > Settings tab > API Access > Generate Keys.

// User 1: integration user, e.g. noviz@your-company.com
const ERP_API_KEY = "";
const ERP_API_SECRET = "";

// User 2: e.g. a sales user (sees only what Sales roles allow)
// const ERP_API_KEY = "";
// const ERP_API_SECRET = "";

// User 3: e.g. an accounts user (sees only what Accounts roles allow)
// const ERP_API_KEY = "";
// const ERP_API_SECRET = "";

// What this layer can run beyond plain lists and records, as the ERPNext
// plugin declares: grouped totals computed by ERPNext, and document actions.
const CAPABILITIES = ["native_aggregate", "document_actions"];

// ---- ERPNext REST, as the API key's user ----

async function erp(path, body) {
  const res = await fetch(ERP_URL + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `token ${ERP_API_KEY}:${ERP_API_SECRET}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // ERPNext's own message goes back to the relay, so the AI can say it.
    let msg = json.exception || `ERPNext returned HTTP ${res.status}`;
    try { msg = JSON.parse(json._server_messages).map((m) => JSON.parse(m).message).join(" ") || msg; } catch {}
    throw new Error(String(msg).replace(/<[^>]+>/g, ""));
  }
  return json.message !== undefined ? json.message : json.data;
}

const method = (name, body) => erp(`/api/method/${name}`, body || {});
const getList = (args) => method("frappe.client.get_list", args);
const getDoc = (doctype, name) => erp(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`);

// A child table (Sales Invoice Item, ...) is read through its parent.
function parentOf(filters) {
  const f = (Array.isArray(filters) ? filters : []).find((t) => t[0] === "parenttype");
  return f ? f[2] : undefined;
}

// Grouped totals computed by ERPNext (GROUP BY), one query per metric,
// merged by group key; only the requested page goes back.
const AGG = { sum: "sum", avg: "avg", count: "count", min: "min", max: "max" };
async function aggregate(spec) {
  const groups = {}, overall = {};
  const metrics = spec.metrics || [];
  const names = metrics.map((m) => m.name || `${m.op}_${m.field || "name"}`);
  const alias = (f) => f.replace(/\./g, "_");
  for (const [i, m] of metrics.entries()) {
    const fn = AGG[m.op];
    if (!fn) throw new Error(`Unsupported aggregate op "${m.op}".`);
    const value = `${fn}(${m.field || "name"}) as _v`;
    const own = m.filters || [];
    const ownFields = new Set(own.map((f) => f[0]));
    const filters = [...(spec.filters || []).filter((f) => !ownFields.has(f[0])), ...own];
    const parent = parentOf(filters);
    const total = await getList({ doctype: spec.doctype, fields: [value], filters, limit_page_length: 0, parent });
    overall[names[i]] = total?.[0]?._v ?? null;
    if (!spec.group_by) continue;
    const carry = spec.carry_fields || [];
    const rows = await getList({ doctype: spec.doctype, fields: [`${spec.group_by} as _key`, ...carry.map((c) => `${c} as ${alias(c)}`), value], filters, group_by: spec.group_by, limit_page_length: 0, parent });
    for (const r of rows) {
      const key = r._key === null || r._key === "" ? "(none)" : r._key;
      const g = (groups[key] ||= { key });
      g[names[i]] = r._v;
      for (const c of carry) g[alias(c)] ??= r[alias(c)];
    }
  }
  const zero = new Set(names.filter((n, i) => ["sum", "count"].includes(metrics[i].op)));
  for (const g of Object.values(groups)) for (const n of names) if (!(n in g)) g[n] = zero.has(n) ? 0 : null;
  let ordered = Object.values(groups).sort((a, b) => String(a.key).localeCompare(String(b.key)));
  if (spec.sort !== "key") ordered.sort((a, b) => (b[names[0]] ?? -Infinity) - (a[names[0]] ?? -Infinity));
  const pageCount = Math.max(1, Math.min(Number(spec.page_count) || 20, 20));
  const pageIndex = Math.max(1, Number(spec.page_index) || 1);
  const start = (pageIndex - 1) * pageCount;
  return { groups: ordered.slice(start, start + pageCount), totalGroups: ordered.length, pageIndex, pageCount, hasMore: start + pageCount < ordered.length, overall };
}

// What can happen next to a document: its workflow transitions, else
// submit / cancel; ERPNext refuses what the user may not do.
async function getActions(spec) {
  const doc = await getDoc(spec.doctype, spec.name);
  const actions = [];
  let workflow = null;
  try {
    const transitions = await method("frappe.model.workflow.get_transitions", { doc });
    if (transitions?.length) workflow = true;
    for (const t of transitions || []) actions.push({ kind: "workflow", action: t.action, next_state: t.next_state });
  } catch {}
  if (!workflow) {
    if (doc.docstatus === 0) actions.push({ kind: "submit" });
    if (doc.docstatus === 1) actions.push({ kind: "cancel" });
  }
  for (const offer of spec.offer || []) {
    if (offer.kind === "make" || offer.kind === "server") actions.push({ kind: offer.kind, action: offer.name, label: offer.label });
  }
  return { doctype: spec.doctype, name: doc.name, docstatus: doc.docstatus, status: doc.status, workflow: workflow ? "workflow" : null, workflow_state: doc.workflow_state ?? null, actions };
}

async function runAction(spec) {
  const action = spec.action || {};
  const doc = await getDoc(spec.doctype, spec.name);
  const done = (d) => ({ ok: true, doctype: d.doctype, name: d.name, docstatus: d.docstatus, status: d.status, workflow_state: d.workflow_state });
  if (action.kind === "workflow") return done(await method("frappe.model.workflow.apply_workflow", { doc, action: action.action }));
  if (action.kind === "submit") return done(await method("frappe.client.submit", { doc }));
  if (action.kind === "cancel") { await method("frappe.client.cancel", { doctype: spec.doctype, name: spec.name }); return done(await getDoc(spec.doctype, spec.name)); }
  if (action.kind === "make") {
    const draft = await method(action.method, { source_name: doc.name });
    return done(await method("frappe.client.insert", { doc: { ...draft, ...(action.values || {}) } }));
  }
  if (action.kind === "server") return { ok: true, doctype: doc.doctype, name: doc.name, result: await method(action.method, { doctype: doc.doctype, name: doc.name, ...(action.values || {}) }) };
  throw new Error(`Unknown document action kind "${action.kind}".`);
}

function reportRows(m) {
  const result = m?.result || [];
  if (result.some((r) => r && !Array.isArray(r) && typeof r === "object")) return result.filter((r) => r && !Array.isArray(r) && typeof r === "object");
  const cols = (m?.columns || []).map((c) => (typeof c === "string" ? c.split(":")[0] : c.fieldname || c.label));
  return result.filter(Array.isArray).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}

// One relay request -> one ERPNext call, the same call kinds as the plugin.
async function runCall(spec) {
  switch (spec.kind) {
    case "get_list":
      return getList({ doctype: spec.doctype, fields: spec.fields?.length ? spec.fields : ["name"], filters: spec.filters, order_by: spec.order_by, limit_start: spec.start || 0, limit_page_length: spec.limit || 20, parent: parentOf(spec.filters) });
    case "get_doc": {
      const doc = await getDoc(spec.doctype, spec.name);
      return spec.fields?.length ? Object.fromEntries(spec.fields.map((f) => [f, doc[f]])) : doc;
    }
    case "create_doc":
      return method("frappe.client.insert", { doc: { doctype: spec.doctype, ...spec.values } });
    case "update_doc":
      return method("frappe.client.set_value", { doctype: spec.doctype, name: spec.name, fieldname: spec.values });
    case "run_report":
      return reportRows(await method("frappe.desk.query_report.run", { report_name: spec.reportName, filters: spec.reportFilters || {} }));
    case "aggregate":
      return aggregate(spec);
    case "get_actions":
      return getActions(spec);
    case "run_action":
      return runAction(spec);
    case "mark_notification_read":
      await method("frappe.desk.doctype.notification_log.notification_log.mark_as_read", { docname: spec.name });
      return { ok: true, id: spec.name };
    default:
      return { error: `This chat cannot run "${spec.kind}" calls.` };
  }
}

// ---- Relay ----

async function relay(path, body) {
  const res = await fetch(NOVIZ_RELAY_URL + "/v1/agent" + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${NOVIZ_TENANT_KEY}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `The relay answered with an error (${res.status}).`);
  return json;
}

let me; // the ERPNext user behind the key, looked up once
async function identity() {
  if (!me) {
    const user = await method("frappe.auth.get_logged_user");
    const roles = await getDoc("User", user).then((u) => (u.roles || []).map((r) => r.role)).catch(() => []);
    me = { erp_user: user, erp_roles: roles, capabilities: CAPABILITIES };
  }
  return me;
}

// Run the relay's ERPNext calls until the answer is final.
async function drive(result) {
  while (result.status === "fetch") {
    let data;
    try { data = await runCall(result.request); } catch (e) { data = { error: e.message }; }
    result = await relay("/turn/continue", { turnId: result.turnId, result: data });
  }
  return result;
}

export async function askNoviz(prompt, previousTurnId) {
  return drive(await relay("/turn", { prompt, previous_turn_id: previousTurnId || null, ...(await identity()) }));
}

export async function nextPage(tool, args) {
  return drive(await relay("/turn/next-page", { tool, args: args || {}, ...(await identity()) }));
}

export async function chatMenu() {
  return relay("/chat-menu").then((r) => r.items || []).catch(() => []);
}
