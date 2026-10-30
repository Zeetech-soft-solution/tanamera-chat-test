# Noviz AI chat for ERPNext (sample)

A small chat page that connects any ERPNext site to the Noviz AI relay over the
ERPNext REST API. No plugin install needed on the ERPNext side.

How it works: the page sends the question to the relay. The relay answers or asks
for one ERPNext call; this server runs that call with the ERPNext API key and sends
the result back, until the relay gives the final answer. Every call runs as the
user who owns the API key, so ERPNext applies that user's own roles and permissions.
The keys stay on the server and never reach the browser.

## Requirements

- Node.js 18 or newer (no packages to install)
- A Noviz AI tenant key (`tnt_...`)
- An ERPNext API key and secret: User > Settings tab > API Access > Generate Keys

## Run

1. Copy `.env.example` to `.env` and fill it in (or fill the `CONFIG` block at the
   top of `server.mjs`; `.env` wins).
2. `node server.mjs`
3. Open http://localhost:5055

## Run on a server

Set `HOST=0.0.0.0`, `CHAT_USER` and `CHAT_PASSWORD` (the server refuses to start on
a public address without them), keep it running (for example with pm2), and put
HTTPS in front (nginx with a certificate).

## Supported ERPNext calls

Lists, single records, create, update, reports and marking notifications read.
Other call kinds are answered with a "not supported" message.
