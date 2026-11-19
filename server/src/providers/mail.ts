// SPDX-License-Identifier: Apache-2.0
import nodemailer from "nodemailer";

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends transactional mail. Self-hosters choose the provider with MAIL_PROVIDER.
 * With "none" nothing is sent, so a server without mail settings never leaks a
 * login link anywhere.
 */
export interface MailProvider {
  readonly name: string;
  readonly canSend: boolean;
  send(mail: Mail): Promise<void>;
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
    await this.transport.sendMail({ from: this.from, ...mail });
  }
}
