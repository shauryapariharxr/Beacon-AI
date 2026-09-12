import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientKey } from "@/lib/rateLimit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_NAME_LENGTH = 100;

/**
 * Contact / complaint form.
 *
 * Sends the message to the app owner's inbox via Resend. Works in sandbox
 * mode (no verified domain) because the recipient (CONTACT_EMAIL) is the
 * Resend account owner's own address — the one address the sandbox always
 * allows. The visitor's email goes into replyTo so the owner can reply
 * with a single click.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function POST(req: NextRequest) {
  try {
    // Per-IP throttle: 5 messages per hour is plenty for a human with a
    // complaint, and it blunts anyone using the form as a spam relay.
    const rl = await rateLimit(clientKey(req, null), 5, 60 * 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Too many messages sent — try again in ${Math.ceil(rl.retryAfterSeconds / 60)} min.` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const apiKey = process.env.RESEND_API_KEY;
    const to = process.env.CONTACT_EMAIL;
    if (!apiKey || !to) {
      return NextResponse.json(
        { error: "The contact form isn't configured on this server yet." },
        { status: 503 }
      );
    }

    const { name, email, message } = await req.json().catch(() => ({}));

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof message !== "string" ||
      !name.trim() ||
      !EMAIL_RE.test(email) ||
      !message.trim() ||
      message.length > MAX_MESSAGE_LENGTH ||
      name.length > MAX_NAME_LENGTH
    ) {
      return NextResponse.json(
        { error: "Please provide your name, a valid email, and a message (max 4000 characters)." },
        { status: 400 }
      );
    }

    const safeName = escapeHtml(name.trim());
    const safeEmail = escapeHtml(email.trim());
    const safeMessage = escapeHtml(message.trim())
      .replace(/\r?\n/g, "<br/>");

    const { error } = (await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "Beacon Contact <onboarding@resend.dev>",
        to,
        replyTo: email.trim(),
        subject: `Beacon contact: ${name.trim().slice(0, 60)}`,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#0b0e13;border-radius:12px;color:#eef0f4;">
            <p style="margin:0 0 4px;font-size:20px;font-weight:700;"><span style="color:#e8a33d;">&#9670;</span> Beacon — new contact message</p>
            <p style="margin:0 0 20px;font-size:13px;color:#8b91a1;">Sent from the Beacon contact form.</p>
            <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#141821;border:1px solid #262b36;border-radius:8px;padding:20px;">
              <tr><td style="padding:4px 0;font-size:14px;color:#8b91a1;">Name</td></tr>
              <tr><td style="padding:0 0 12px;font-size:14px;color:#eef0f4;">${safeName}</td></tr>
              <tr><td style="padding:4px 0;font-size:14px;color:#8b91a1;">Email</td></tr>
              <tr><td style="padding:0 0 12px;font-size:14px;color:#eef0f4;">${safeEmail}</td></tr>
              <tr><td style="padding:4px 0;font-size:14px;color:#8b91a1;">Message</td></tr>
              <tr><td style="padding:0;font-size:14px;color:#eef0f4;line-height:1.6;">${safeMessage}</td></tr>
            </table>
            <p style="margin:16px 0 0;font-size:12px;color:#5b6270;">Reply directly to this email to answer ${safeName}.</p>
          </div>`,
      }),
    }).catch((e) => ({ error: { message: e?.message || "network error" } }))) as {
      error?: { message?: string } | null;
    };

    if (error) {
      console.error("Contact email failed:", error);
      return NextResponse.json(
        { error: "Your message couldn't be sent right now — please try again later." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Contact route failed:", err);
    return NextResponse.json(
      { error: "Message couldn't be sent — " + (err?.message || "server error") },
      { status: 500 }
    );
  }
}
