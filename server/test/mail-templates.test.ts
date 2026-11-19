// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { loginMail, sosMail } from "../src/lib/mail-templates.js";

// Signal green (#c5f04a) only means "on": the SOS mail must not get a green button in dark mode.
describe("mail colours", () => {
  it("gives the SOS mail an ink button in dark mode, not signal green", () => {
    const mail = sosMail("parent@example.org", "en", "https://pp.example", "p1", "SOS", "Help");
    expect(mail.html).toContain('class="pp-button pp-neutral"');
    expect(mail.html).toContain('class="pp-link pp-neutral"');
    expect(mail.html).toContain(".pp-button.pp-neutral { background:#f2f2ef !important; }");
    expect(mail.text).toContain("Open SOS in Plainphone: https://pp.example/phones/p1");
  });

  it("keeps the signal green action button on ordinary mails", () => {
    const mail = loginMail("parent@example.org", "en", "https://pp.example", "https://pp.example/l", 15);
    expect(mail.html).toContain('class="pp-button" bgcolor');
    expect(mail.html).not.toContain('class="pp-button pp-neutral"');
  });
});
