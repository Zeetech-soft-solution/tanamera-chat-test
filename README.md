# Noviz AI for ERPNext: chat integration template

Plug Noviz AI into your own chat. No packages (Node.js 18+).

| File | What it is | In your app |
|---|---|---|
| `noviz.mjs` | The calling code: `askNoviz(message, turnId, onStep)` | Copy into your **backend** as is; fill the keys at the top |
| `server.mjs` | Example backend route `POST /api/noviz/ask` (streams steps, then the answer) | Copy the marked route into **your backend** |
| `chat.html` | Example chat page (dark messenger style): steps, "Worked Xs", reply, Noviz AI results | Copy the marked parts into **your chat UI** |
| `noviz-chat.css` | Noviz AI's own styles for its rendered tables, cards and charts | Load it **unchanged** in your chat UI |

## Architecture

```
Your chat UI ──message──> Your backend: /api/noviz/ask -> askNoviz() ──> Noviz AI relay (the AI)
     ^                          │  runs each ERPNext call the relay asks for
     │                          └──> Your ERPNext (REST API, as the user)
     └── steps (live), then reply + Noviz AI html (tables / cards / charts)
```

The relay never touches ERPNext and never holds ERPNext keys. Every ERPNext call runs
in your backend as the user who owns the API key, so ERPNext applies that user's roles
and permissions. Keep the keys on the server; never send them to a browser.

## Where what changes

Search the files for `INTEGRATION POINT`.

**Backend** (`server.mjs`)
- Copy the `POST /api/noviz/ask` route. Check your logged-in user there; in production load
  that user's ERPNext key from your database.

**Chat UI** (`chat.html`)
1. Theme: CSS variables in `:root`.
2. Agent name and badge: `AGENT`.
3. Backend route: `API_URL`.
4. Assistant message: "Worked Xs", the steps list, the reply (markdown) and the Noviz AI
   html. The html must sit inside `<div class="nz-root nz-result">` with `noviz-chat.css`
   loaded, or tables, cards and charts show unstyled. Keep the `[data-action]` click
   handler: record IDs and next-step buttons send their follow-up question.
5. Conversation memory: store `turnId` per conversation; no turnId = new conversation.
6. PDF links in results: `ERP_LINK_BASE` = your ERPNext URL (empty hides them).

## Run the example

Fill the keys at the top of `noviz.mjs`, then `node server.mjs` and open http://localhost:5055.
Or without a page: `node example.mjs "how many customers do we have?"`
