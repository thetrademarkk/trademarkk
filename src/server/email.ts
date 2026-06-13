import "server-only";
import { serverEnv, hasResend } from "./env";

/** Sends via Resend when configured; logs to server console in dev otherwise. */
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!hasResend()) {
    console.log(`[email:dev] To: ${to}\nSubject: ${subject}\n${html}`);
    return;
  }
  const { Resend } = await import("resend");
  const resend = new Resend(serverEnv.resendApiKey);
  await resend.emails.send({ from: serverEnv.emailFrom, to, subject, html });
}

export function emailLayout(title: string, body: string, ctaText?: string, ctaUrl?: string) {
  const button = ctaUrl
    ? `<a href="${ctaUrl}" style="display:inline-block;background:#8B5CF6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px">${ctaText}</a>`
    : "";
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0A0A0B;color:#FAFAFA;border-radius:12px">
    <h2 style="margin:0 0 8px">TradeMarkk</h2>
    <h3 style="margin:0 0 16px;color:#A1A1AA;font-weight:500">${title}</h3>
    <p style="line-height:1.6">${body}</p>${button}
    <p style="margin-top:24px;color:#71717A;font-size:12px">Mark your trade, every day.</p>
  </div>`;
}
