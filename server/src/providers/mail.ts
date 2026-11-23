// SPDX-License-Identifier: Apache-2.0
import nodemailer from "nodemailer";

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendOptions {
  /** An SOS: sent even when the server's own mail cap is reached (it is still counted). */
  urgent?: boolean;
}

/** The answer code for "we can't send mail right now" (docs/operations.md, "Mail caps"). */
export const MAIL_UNAVAILABLE_CODE = "mail_unavailable";

/**
 * No mail can go out right now: the server's own cap (MAIL_HOURLY_CAP, MAIL_DAILY_CAP) is reached,
 * or the mail server answered with a temporary 4xx (often its own rate limit). The message holds
 * the SMTP code only, never the server's text, which can echo the recipient.
 */
export class MailUnavailableError extends Error {
  constructor(
    readonly reason: "cap" | "provider",
    /** When the cap's window ends; unset for a refusal by the mail server. */
    readonly retryAt?: Date,
    readonly smtpCode?: number,
  ) {
    super(reason === "cap" ? "the server's mail cap is reached" : `the mail server refused for now (SMTP ${smtpCode})`);
    this.name = "MailUnavailableError";
  }
}

/**
 * Sends transactional mail. Self-hosters choose the provider with MAIL_PROVIDER.
 * With "none" nothing is sent, so a server without mail settings never leaks a
 * login link anywhere.
 */
export interface MailProvider {
  readonly name: string;
  readonly canSend: boolean;
  send(mail: Mail, opts?: SendOptions): Promise<void>;
}

export class NoMailProvider implements MailProvider {
  readonly name = "none";
  readonly canSend = false;
  async send() {}
}

/** Development only: prints the text version, including login links, to stdout. */
export class LogMailProvider implements MailProvider {
  readonly name = "log";
  readonly canSend = true;
  async send(mail: Mail) {
    console.log(`--- mail to ${mail.to}: ${mail.subject}\n${mail.text}\n---`);
  }
}

/** Collects mails in memory. Used in tests. */
export class MemoryMailProvider implements MailProvider {
  readonly name = "memory";
  readonly canSend = true;
  readonly outbox: Mail[] = [];
  async send(mail: Mail) {
    this.outbox.push(mail);
  }
}

export class SmtpMailProvider implements MailProvider {
  readonly name = "smtp";
  readonly canSend = true;
  private readonly transport;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    // Bounded, so a stalled server cannot hold up an urgent SOS retry past its lease.
    const url = new URL(smtpUrl);
    for (const [name, ms] of [["connectionTimeout", 10_000], ["greetingTimeout", 10_000], ["socketTimeout", 15_000]] as const) {
      if (!url.searchParams.has(name)) url.searchParams.set(name, String(ms));
    }
    this.transport = nodemailer.createTransport(url.toString());
  }

  async send(mail: Mail) {
    try {
      await this.transport.sendMail({ from: this.from, ...mail });
    } catch (err) {
      throw smtpError(err);
    }
  }
}

/** A temporary SMTP answer (4xx, e.g. 421, 450, 451, 452) becomes MailUnavailableError; 5xx and the rest stay as they are. */
export function smtpError(err: unknown): unknown {
  const code = (err as { responseCode?: unknown } | null)?.responseCode;
  if (typeof code === "number" && code >= 400 && code < 500) return new MailUnavailableError("provider", undefined, code);
  return err;
}
