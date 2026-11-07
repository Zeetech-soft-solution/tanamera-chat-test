# tanamera-chat-test

A small Next.js chat that uses Noviz AI through the **Tanamera chat gateway**. It is our
test site, and the template for adding Noviz AI to Tanamera's own chat (Next.js App
Router, same request as their agent routes: `POST { message, conversationId }`).

## What goes into your chat

One folder, four files. Copy the folder `app/api/agents/red/noviz/` into your Next.js app
(next to your other agents in `app/api/agents/red/`):

| File | What it is | You change |
|---|---|---|
| `route.ts` | **Every Noviz AI route in one file**, one commented section each: chat, stream, show more, menu, report PDF, document PDF; plus the gateway call (the tenant key and the user's ERPNext key never reach the browser) | only `currentNovizUser()` at the bottom |
| `Noviz.tsx` | Everything the browser needs: `readNovizEvents()` (reads the stream), `<NovizSteps>` ("Working… 3.1s", then "Worked 9.4s · 5 steps ▾"), `<NovizAnswer>` (tables, cards, charts; record IDs and next steps ask their follow-up) | nothing |
| `noviz.css` | Results and steps in your dark style | the colours, to your theme |
| `noviz-chat.css` | Noviz AI's result styles | never (same copy as every Noviz app) |

Only `route.ts` becomes a URL; Next.js leaves the other files in the folder alone.

The routes `route.ts` answers (`?route=` picks one; none is the chat):

| Route | What it does |
|---|---|
| `POST /api/agents/red/noviz` | Chat: `{ message, conversationId }` → an assistant message in your message shape, plus `html` |
| `POST /api/agents/red/noviz?route=stream` | The same, as a stream: the steps while Noviz AI works, then the answer (see "Steps while it works") |
| `POST /api/agents/red/noviz?route=next-page` | "Show me more" under a result: `{ tool, args, conversationId }` |
| `GET /api/agents/red/noviz?route=menu` | The + menu items (Approvals, Mail) |
| `GET /api/agents/red/noviz?route=pdf&spec=` | "Download PDF" under an answer (the gateway builds it from your ERPNext) |
| `GET /api/agents/red/noviz?route=document-pdf&doctype=&name=` | "Download PDF" of one document (a quotation, an invoice): ERPNext's own print |

`app/page.tsx` is the test chat: a full working page that uses all of it.

You manage your users, sessions and ERPNext keys. `currentNovizUser()` returns them as
variables; Noviz AI stores none of it:

```ts
return { chatUser, erpApiKey, erpApiSecret };
```

In your chat page, under an assistant message:

```tsx
<YourMarkdown>{message.content}</YourMarkdown>
{message.html && (
  <NovizAnswer html={message.html} onAsk={(text, hidden) => send(text, { hidden })}
               onNextPage={(tool, args) => nextPage(tool, args)} erpBaseUrl={ERP_URL} />
)}
```

## Settings (`.env`)

```
NOVIZ_GATEWAY_URL=https://tanamera-gateway.noviz.in
NOVIZ_TENANT_KEY=tnt_...
NEXT_PUBLIC_ERP_BASE_URL=https://your-erpnext   # other ERPNext links in results open there
```

## The gateway call (in `route.ts`)

Server to server, every request:

```
POST https://tanamera-gateway.noviz.in/v1/chat
Authorization: Bearer tnt_<Noviz AI tenant key>
X-Chat-User: <your chat user id>
X-ERP-Authorization: token <api_key>:<api_secret>
Content-Type: application/json

{ "message": "How many open sales orders?", "conversationId": "c1", "can_continue": true }
```

Answer: `{ conversationId, status: "final", turnId, reply, html, document }` (`reply` is
markdown, `html` goes to `NovizAnswer`), or `{ status: "working", turnId }`: call
`/v1/chat/continue` until final. Errors: `{ error: { code, message } }`.

## Steps while it works (stream)

`POST /v1/chat/stream` takes the same headers and `{ message, conversationId }` and answers
`text/event-stream` (Server-Sent Events). The stream stays open until the answer is final
(no `working` / continue):

```
event: step
data: {"id":1,"label":"Understanding your question","status":"running"}

event: step
data: {"id":1,"label":"Understanding your question","status":"done","ms":1840}

event: step
data: {"id":2,"label":"Looking up Sales Invoice list","status":"running"}
...
event: answer
data: {"conversationId":"c1","status":"final","turnId":"…","reply":"…","html":"…","document":null}
```

- `step`: `{ id, label, status: "running" | "done" | "error", ms }`; a later event for the
  same `id` replaces the earlier one. `error` means ERPNext refused that call (the AI reads
  the refusal and carries on).
- `answer`: exactly the `/v1/chat` answer. `error`: `{ error: { code, message } }`, last event.
- Lines starting with `:` only keep the connection open; skip them.

Your route passes the stream to the browser as it is (section 2 of `route.ts`); the page reads it
with `fetch` + `response.body.getReader()` (`readNovizEvents` in `Noviz.tsx`) and shows
`<NovizSteps>`. Behind nginx, keep `proxy_buffering` off for this route (the responses
carry `X-Accel-Buffering: no`).

## Run the test chat

```
npm install
npm run build && npm start      # http://localhost:3000
```
