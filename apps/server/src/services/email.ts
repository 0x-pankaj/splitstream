/**
 * Transactional email for creator login one-time codes.
 *
 * In production an `EMAIL_API_KEY` (Resend) is set and the code is emailed. With
 * zero keys (local dev), the code is logged to stdout so the email→OTP flow is
 * fully exercisable without a provider — the same mirror-mode discipline the rest
 * of the stack follows.
 */

import { config } from "../config.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface SentOtp {
  /** "email" when a real message was sent; "console" in keyless dev. */
  channel: "email" | "console";
}

/** Email (or, in dev, log) a 6-digit login code to a creator. */
export async function sendOtpEmail(email: string, code: string): Promise<SentOtp> {
  if (!config.email) {
    // Keyless dev: surface the code so the developer can complete the login.
    console.log(`[creator-otp] login code for ${email}: ${code}`);
    return { channel: "console" };
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.email.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: config.email.from,
      to: [email],
      subject: "Your SplitStream login code",
      text: `Your SplitStream login code is ${code}. It expires in 10 minutes.`,
      html:
        `<p>Your SplitStream login code is</p>` +
        `<p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>` +
        `<p>It expires in 10 minutes. If you didn't request this, you can ignore it.</p>`,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Failed to send login email (${res.status}): ${detail.slice(0, 200)}`);
  }
  return { channel: "email" };
}
