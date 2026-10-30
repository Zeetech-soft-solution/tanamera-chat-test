# Noviz AI for ERPNext: chat integration template

Plug Noviz AI into your own chat. One file, `noviz.mjs`, no packages (Node.js 18+).

1. Fill the settings at the top of `noviz.mjs`: Noviz AI tenant key, ERPNext URL,
   ERPNext API key and secret (User > Settings > API Access > Generate Keys).
2. From your chat backend, for each user message:

```js
import { askNoviz } from "./noviz.mjs";

const answer = await askNoviz(userMessage, previousTurnId);
// show answer.reply (markdown) and answer.html (table/chart, if any)
// keep answer.turnId and pass it next time to continue the conversation
```

Try it: `node example.mjs "how many customers do we have?"`

Every ERPNext call runs as the user who owns the API key, so ERPNext applies that
user's roles and permissions. Keep the keys on your server; never send them to a browser.
