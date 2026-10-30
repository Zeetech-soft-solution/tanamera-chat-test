# tanamera-chat-test

A small Next.js chat that uses Noviz AI through the **Tanamera chat gateway**. It is our
test site, and the template for adding Noviz AI to Tanamera's own chat (Next.js App
Router, same request as their agent routes: `POST { message, conversationId }`).

## What goes into your chat

| File | What it is | You change |
|---|---|---|
| `lib/noviz/gateway.ts` | Calls the gateway from your server (the tenant key and the user's ERPNext key never reach the browser); continues long answers | nothing |
| `app/api/agents/red/noviz/route.ts` | Noviz AI as one of your agents: `POST { message, conversationId }` → an assistant message in your message shape, plus `html` | nothing |
| `app/api/agents/red/noviz/next-page/route.ts` | "Show me more" under a result | nothing |
| `app/api/agents/red/noviz/menu/route.ts` | The + menu items (Approvals, Mail) | nothing |
| `app/api/agents/red/noviz/pdf/route.ts` | "Download PDF" under an answer (the gateway builds it from your ERPNext) | nothing |
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

## Run the test chat

```
npm install
npm run build && npm start      # http://localhost:3000
```
