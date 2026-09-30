import "server-only";

/**
 * Sending email.
 *
 * There is no mail server configured yet, and pretending otherwise is the
 * failure mode worth avoiding: a verification link that the sender believes
 * was delivered and was not is worse than one they know they have to copy.
 *
 * So this has two honest modes. With `RESEND_API_KEY` set it sends. Without
 * one it logs the message to the server console and reports `delivered: false`
 * with the link, and the caller shows that link on screen rather than saying
 * "check your email".
 *
 * Resend because its free tier is 3,000 messages a month and it needs one
 * environment variable. Any provider with an HTTP API would drop in here; what
 * must not change is that an unconfigured install still works and says so.
 */

export type MailResult = { delivered: boolean; reason?: string };

export type MailMessage = {
  to: string;
  subject: string;
  /** Plain text. These messages are short and transactional; HTML buys nothing
   *  and costs deliverability. */
  text: string;
};

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;

  if (!apiKey || !from) {
    // Not an error. It is the state the application ships in.
    console.info(
      `\n──────── email not sent (no RESEND_API_KEY / MAIL_FROM) ────────\n` +
        `To:      ${message.to}\n` +
        `Subject: ${message.subject}\n\n` +
        `${message.text}\n` +
        `────────────────────────────────────────────────────────────────\n`,
    );
    return { delivered: false, reason: "not configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`Mail send failed (${response.status}): ${body.slice(0, 300)}`);
      return { delivered: false, reason: `provider returned ${response.status}` };
    }

    return { delivered: true };
  } catch (err) {
    console.error("Mail send threw:", err);
    return { delivered: false, reason: "network" };
  }
}

// ─────────────────────────────────────────────────────────── templates ───

export function verificationEmail(link: string, workspaceName: string): MailMessage["text"] {
  return [
    `Confirm your email to finish setting up ${workspaceName}.`,
    ``,
    link,
    ``,
    `The link works once and expires in 24 hours.`,
    `If you did not sign up, ignore this — nothing has been created yet.`,
  ].join("\n");
}

export function invitationEmail(link: string, workspaceName: string, inviterName: string, roleName: string): MailMessage["text"] {
  return [
    `${inviterName} has invited you to ${workspaceName} as ${roleName}.`,
    ``,
    link,
    ``,
    `You will set your own password — nobody there will ever see it.`,
    `The link works once and expires in 72 hours.`,
  ].join("\n");
}
