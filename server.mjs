// Example server: serves the chat page and the chat API the page calls.
// In your app, copy the three /api routes into your own backend and keep
// noviz.mjs next to them.
//
//   POST /api/send       { prompt, previous_turn_id } -> final answer
//   POST /api/next_page  { tool, args }               -> next page of a list
//   GET  /api/chat_menu                               -> { items }
//
// Run: node server.mjs  ->  http://localhost:5055

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askNoviz, nextPage, chatMenu } from "./noviz.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5055);
const FILES = { "/": ["chat.html", "text/html"], "/chat.html": ["chat.html", "text/html"], "/noviz-chat.css": ["noviz-chat.css", "text/css"] };

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || "{}");
}

http.createServer(async (req, res) => {
  const file = req.method === "GET" && FILES[req.url];
  if (file) {
    res.writeHead(200, { "Content-Type": `${file[1]}; charset=utf-8` });
    return res.end(fs.readFileSync(path.join(here, file[0])));
  }
  try {
    if (req.method === "POST" && req.url === "/api/send") {
      const { prompt, previous_turn_id } = await readBody(req);
      if (!prompt) return json(res, 400, { error: "Please type a question." });
      return json(res, 200, await askNoviz(prompt, previous_turn_id));
    }
    if (req.method === "POST" && req.url === "/api/next_page") {
      const { tool, args } = await readBody(req);
      return json(res, 200, await nextPage(tool, args));
    }
    if (req.method === "GET" && req.url === "/api/chat_menu") {
      return json(res, 200, { items: await chatMenu() });
    }
  } catch (e) {
    return json(res, 502, { error: e.message });
  }
  res.writeHead(404).end();
}).listen(PORT, "127.0.0.1", () => console.log(`Chat: http://localhost:${PORT}`));
