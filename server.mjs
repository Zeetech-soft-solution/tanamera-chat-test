// Example backend: serves chat.html and one API route that calls askNoviz.
//
// WHERE THIS GOES IN YOUR APP: you already have a backend. Copy only the
// POST /api/noviz/ask handler below into it (Express, Next.js route, etc.).
// Keep noviz.mjs next to it. The keys stay in noviz.mjs on the server.
//
// Run the example: node server.mjs  ->  http://localhost:5055

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askNoviz } from "./noviz.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5055;

http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/chat.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(fs.readFileSync(path.join(here, "chat.html")));
  }
  if (req.method === "GET" && req.url === "/noviz-chat.css") {
    res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
    return res.end(fs.readFileSync(path.join(here, "noviz-chat.css")));
  }

  // ---- INTEGRATION POINT (backend): copy this route into your backend ----
  // Body: { message, turnId }. Response: one JSON object per line (NDJSON):
  //   {"type":"step","label":"Read Customer list","ok":true,"ms":412}
  //   {"type":"final","reply":"...","html":"...","turnId":"...","ms":5230}
  //   {"type":"error","message":"..."}
  // Your app: check the logged-in user here, and in production load that
  // user's ERPNext key from your database before calling askNoviz.
  if (req.method === "POST" && req.url === "/api/noviz/ask") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const { message, turnId } = JSON.parse(raw || "{}");
    res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });
    const send = (obj) => res.write(JSON.stringify(obj) + "\n");
    try {
      const answer = await askNoviz(message, turnId, (step) => send({ type: "step", ...step }));
      send({ type: "final", ...answer });
    } catch (e) {
      send({ type: "error", message: e.message });
    }
    return res.end();
  }
  // ---- end of integration point ----

  res.writeHead(404).end();
}).listen(PORT, "127.0.0.1", () => console.log(`Chat: http://localhost:${PORT}`));
