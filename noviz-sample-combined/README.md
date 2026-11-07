# Noviz AI sample: the whole integration in one folder

This folder holds everything needed to add Noviz AI to a Next.js chat (App Router), in
four files. It does the same as the full test project around it, combined into one folder.

| File | What it is | You change |
|---|---|---|
| `route.ts` | Every Noviz AI route in one file, one commented section each, plus the gateway call. The tenant key and the user's ERPNext key stay on your server. | only `currentNovizUser()` at the bottom |
| `Noviz.tsx` | Everything the browser needs: `readNovizEvents()`, `<NovizSteps>`, `<NovizAnswer>` | nothing |
| `noviz.css` | Results and steps in your dark style | the colours, to your theme |
| `noviz-chat.css` | Noviz AI's result styles | never (same copy as every Noviz app) |

## 1. Copy the folder

Copy the four files into your app at:

```
app/api/agents/red/noviz/
  route.ts
  Noviz.tsx
  noviz.css
  noviz-chat.css
```

Next.js turns only `route.ts` into a URL (`/api/agents/red/noviz`). The other files in the
folder are left alone, so the whole integration stays together.

Install the two packages it uses:

```
npm install undici@6.24.1 react-markdown remark-gfm
```

(`react-markdown` and `remark-gfm` render the reply text, which is markdown. Use your own
markdown renderer instead if your chat has one.)

## 2. Settings (`.env`)

```
NOVIZ_GATEWAY_URL=https://tanamera-gateway.noviz.in
NOVIZ_TENANT_KEY=tnt_...
```

## 3. Your user: the one function you replace

At the bottom of `route.ts`, `currentNovizUser()` returns who is chatting. Return the
signed-in chat user from your session and the ERPNext key you assigned to them, or `null`
when no one is signed in:

```ts
async function currentNovizUser(): Promise<NovizUser | null> {
  const session = await yourSession();            // your login
  if (!session) return null;
  const key = await yourErpKeyFor(session.userId); // your key store
  return { chatUser: session.userId, erpApiKey: key.apiKey, erpApiSecret: key.apiSecret };
}
```

You manage your users, sessions and ERPNext keys; Noviz AI stores none of it.

## 4. The routes

`route.ts` answers all of these; `?route=` picks one, and no `?route=` is the chat:

| Route | What it does |
|---|---|
| `POST /api/agents/red/noviz` | Chat: `{ message, conversationId }` → an assistant message, plus `html` |
| `POST /api/agents/red/noviz?route=stream` | The same, as a stream: the steps while Noviz AI works, then the answer |
| `POST /api/agents/red/noviz?route=next-page` | "Show me more" under a result: `{ tool, args, conversationId }` |
| `GET /api/agents/red/noviz?route=menu` | The + menu items (Approvals, Mail) |
| `GET /api/agents/red/noviz?route=pdf&spec=` | "Download PDF" under an answer |
| `GET /api/agents/red/noviz?route=document-pdf&doctype=&name=` | "Download PDF" of one document (a quotation, an invoice) |

## 5. Your chat page

Import from the folder:

```tsx
import { NovizAnswer, NovizSteps, NovizStep, readNovizEvents } from "@/app/api/agents/red/noviz/Noviz";
```

**Ask a question (streamed, so the steps show while it works):**

```tsx
const res = await fetch("/api/agents/red/noviz?route=stream", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: text, conversationId }),
});
await readNovizEvents(res.body!, (event, data) => {
  if (event === "step") {
    // { id, label, status: "running" | "done" | "error", ms }
    // a later event with the same id replaces the earlier one
  }
  if (event === "answer") {
    // { conversationId, turnId, reply, html, document }
    // keep conversationId for the next message
  }
  if (event === "error") {
    // { error: { code, message } }
  }
});
```

**Under each assistant message:**

```tsx
<NovizSteps steps={message.steps} startedAt={message.startedAt} endedAt={message.endedAt} />
<YourMarkdown>{message.content}</YourMarkdown>      {/* the answer's reply (markdown) */}
{message.html && (
  <NovizAnswer
    html={message.html}
    onAsk={(text, hidden) => ask(text, hidden)}         // a record ID or next step was clicked
    onNextPage={(tool, args) => nextPage(tool, args)}   // "Show me more"
    erpBaseUrl={process.env.NEXT_PUBLIC_ERP_BASE_URL}    // other ERPNext links open there
  />
)}
```

- Leave `endedAt` undefined while it works; set it when the `answer` or `error` event
  arrives.
- `onAsk(text, hidden)`: send `text` as the next question; `hidden` means don't show it as
  the user's message.

**"Show me more":**

```tsx
const nextPage = async (tool, args) => {
  const res = await fetch("/api/agents/red/noviz?route=next-page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args, conversationId }),
  });
  const { message } = await res.json(); // { content, html, ... } → add as an assistant message
};
```

**The + menu:**

```tsx
const { items } = await (await fetch("/api/agents/red/noviz?route=menu")).json();
// each item: { id, label, prompt } → clicking it asks item.prompt
```

**PDFs:** nothing to do. `<NovizAnswer>` points every "Download PDF" link in a result at
`?route=pdf` or `?route=document-pdf` on your own route.

## 6. Behind nginx

Keep `proxy_buffering off` for the stream, or the steps arrive all at once at the end. The
stream responses already send `X-Accel-Buffering: no`.

## Errors

Every route answers errors as `{ error, code }` with the gateway's status. `401` means
`currentNovizUser()` returned `null`.
