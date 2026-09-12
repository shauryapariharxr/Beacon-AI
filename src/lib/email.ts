// Email verification via Resend (https://resend.com — free tier: 100/day).
// Configure RESEND_API_KEY and EMAIL_FROM in your environment. If RESEND_API_KEY
// is not set, verification emails are skipped and signup behaves like before
// (user is verified immediately) — this keeps local dev frictionless.

import { Resend } from "resend";

const FROM = process.env.EMAIL_FROM || "Beacon <onboarding@resend.dev>";

export function emailVerificationConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Send the verification email. Returns the error message on failure, or
 * null on success.
 */
export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<string | null> {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: FROM,
      to,
      subject: "Verify your Beacon account",
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0f1218;border-radius:16px;color:#eef0f4;">
          <div style="font-size:22px;font-weight:700;margin-bottom:8px;">
            <span style="color:#e8a33d;">◆</span> Beacon
          </div>
          <p style="color:#8b91a1;font-size:14px;line-height:1.6;margin:0 0 24px;">
            One click and your account is live. This link expires in 24 hours.
          </p>
          <a href="${verifyUrl}"
             style="display:inline-block;background:linear-gradient(90deg,#e8a33d,#f97316);color:#1a1204;font-weight:600;font-size:14px;padding:12px 28px;border-radius:12px;text-decoration:none;">
            Verify my email
          </a>
          <p style="color:#8b91a1;font-size:12px;line-height:1.6;margin:24px 0 0;">
            Or paste this link into your browser:<br/>
            <a href="${verifyUrl}" style="color:#e8a33d;word-break:break-all;">${verifyUrl}</a>
          </p>
          <p style="color:#5b6270;font-size:12px;margin:24px 0 0;">
            Didn't create a Beacon account? You can ignore this email.
          </p>
        </div>
      `,
    });
    if (error) {
      console.error("Verification email failed:", error);
      return error.message || "Failed to send verification email";
    }
    return null;
  } catch (err: any) {
    console.error("Verification email threw:", err);
    return err?.message || "Failed to send verification email";
  }
}
