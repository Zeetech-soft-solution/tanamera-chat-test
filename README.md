# Noviz AI for ERPNext: chat integration template

Plug Noviz AI into your own chat. One file, `noviz.mjs`, no packages (Node.js 18+).

## Architecture

```
Your chat UI ──message──> Your chat backend (noviz.mjs) ──> Noviz AI relay (the AI)
                                   │  runs each ERPNext call the relay asks for
                                   └──> Your ERPNext (REST API, as the user)
Your chat UI <──reply + table/chart── Your chat backend
```

The relay never touches ERPNext and never holds ERPNext keys. Every ERPNext call runs
in your backend as the user who owns the API key, so ERPNext applies that user's roles
and permissions.

## Add it to your chat

1. Copy `noviz.mjs` into your chat backend. Fill the settings at the top: Noviz AI
   tenant key, ERPNext URL, ERPNext API key and secret
   (User > Settings > API Access > Generate Keys).
2. Where your backend receives a user message:

```js
import { askNoviz } from "./noviz.mjs";

const answer = await askNoviz(message, conversation.novizTurnId);
conversation.novizTurnId = answer.turnId; // keeps the conversation going
// send answer.reply (markdown) and answer.html (table/chart, if any) to the chat
```

3. Show a "thinking..." state while waiting; one answer can take several ERPNext calls.
4. For a new conversation, pass no turnId.

The comments at the top of `noviz.mjs` cover the details (errors, writes, keys).

Try it: `node example.mjs "how many customers do we have?"`

Keep the keys on your server; never send them to a browser. In production, read
them per logged-in user from your database (one ERPNext key or OAuth token per person).
