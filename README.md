# tanamera-chat-test

A small Next.js chat that uses Noviz AI through the **Tanamera chat gateway**. It is our
test site, and the template for adding Noviz AI to Tanamera's own chat (Next.js App
Router, same request as their agent routes: `POST { message, conversationId }`).

> **Want it in one folder?** [`noviz-sample-combined/`](noviz-sample-combined/) has the same integration
> combined into four files (one route file, one component file, two stylesheets), with a
> step-by-step guide in [`noviz-sample-combined/README.md`](noviz-sample-combined/README.md).

## What goes into your chat

| File | What it is | You change |
|---|---|---|
| `lib/noviz/gateway.ts` | Calls the gateway from your server (the tenant key and the user's ERPNext key never reach the browser); continues long answers | nothing |
| `app/api/agents/red/noviz/route.ts` | Noviz AI as one of your agents: `POST { message, conversationId }` → an assistant message in your message shape, plus `html` | nothing |
| `app/api/agents/red/noviz/stream/route.ts` | The same agent answered as a stream: the steps while Noviz AI works, then the answer (see "Steps while it works") | nothing |
| `components/noviz/NovizSteps.tsx` + `noviz-steps.css` | "Working… 3.1s" with the current step, then "Worked 9.4s · 5 steps ▾" above the reply | the colours, to your theme |
| `app/api/agents/red/noviz/next-page/route.ts` | "Show me more" under a result | nothing |
| `app/api/agents/red/noviz/menu/route.ts` | The + menu items (Approvals, Mail) | nothing |
| `app/api/agents/red/noviz/pdf/route.ts` | "Download PDF" under an answer (the gateway builds it from your ERPNext) | nothing |
| `app/api/agents/red/noviz/pdf/document/route.ts` | "Download PDF" of one document (a quotation, an invoice): ERPNext's own print, through the gateway | nothing |
| `components/noviz/NovizAnswer.tsx` | Shows Noviz AI's tables, cards and charts under the message text; record IDs and next steps ask their follow-up | nothing |
| `components/noviz/noviz-chat.css` | Noviz AI's result styles | never (same copy as every Noviz app) |
| `components/noviz/noviz-answer.css` | Those results in your dark style | the colours, to your theme |
| `lib/currentUser.ts` | **The one function you replace**: return the signed-in chat user and the ERPNext key you assigned to them | yes |

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

## The gateway call (`lib/noviz/gateway.ts`)

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

Your route passes the stream to the browser as it is (`stream/route.ts`); the page reads it
with `fetch` + `response.body.getReader()` (`readEvents` in `app/page.tsx`) and shows
`<NovizSteps>`. Behind nginx, keep `proxy_buffering` off for this route (the responses
carry `X-Accel-Buffering: no`).

## Run the test chat

```
npm install
npm run build && npm start      # http://localhost:3000
```
