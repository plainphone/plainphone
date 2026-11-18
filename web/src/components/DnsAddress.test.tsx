// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { makeT } from "../i18n/translate";
import { DnsAddress } from "./DnsAddress";

vi.mock("../i18n/I18n", () => ({ useI18n: () => ({ t: makeT("en") }) }));

describe("DNS address", () => {
  it("keeps the section hidden until the server supplies the provisioned host", () => {
    expect(renderToStaticMarkup(<DnsAddress host={null} />)).toBe("");
  });

  it("presents both clipboard values and labels in the connection details", () => {
    const host = "test-profile.dns.example.org";
    const html = renderToStaticMarkup(<DnsAddress host={host} />);

    expect(html).toContain(`<code>${host}</code>`);
    expect(html).toContain("<code>tls://test-profile.dns.example.org:853</code>");
    expect(html).toContain("Port 853");
    expect(html).toContain('aria-label="Copy DNS-over-TLS hostname"');
    expect(html).toContain('aria-label="Copy DNS-over-TLS address for clients that use tls://"');
  });
});
