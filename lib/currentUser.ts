/**
 * TEST PROJECT ONLY: the chat user and their ERPNext key come from this test
 * site's settings. In Tanamera's chat, this is your existing session and your
 * existing per-user key store; replace this one function.
 *
 * .env (test site):
 *   TEST_CHAT_USER=noviz-test
 *   TEST_ERP_API_KEY=...
 *   TEST_ERP_API_SECRET=...
 */
import "server-only";
import { NovizUser } from "./noviz/gateway";

export async function currentNovizUser(): Promise<NovizUser | null> {
  const chatUser = process.env.TEST_CHAT_USER;
  const erpApiKey = process.env.TEST_ERP_API_KEY;
  const erpApiSecret = process.env.TEST_ERP_API_SECRET;
  return chatUser && erpApiKey && erpApiSecret ? { chatUser, erpApiKey, erpApiSecret } : null;
}
