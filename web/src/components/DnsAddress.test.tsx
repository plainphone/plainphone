// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeT } from "../i18n/translate";
import { DnsAddress } from "./DnsAddress";

vi.mock("../i18n/I18n", () => ({ useI18n: () => ({ t: makeT("en") }) }));
vi.mock("react/jsx-runtime", { spy: true });
vi.mock("react/jsx-dev-runtime", { spy: true });

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("DNS address", () => {
  it("keeps the section hidden until the server supplies the provisioned host", () => {
    expect(renderToStaticMarkup(<DnsAddress host={null} />)).toBe("");
  });

  it.each([
    ["strong", "filter.addressAndroidStrong", "filter.addressTailscaleStrong", "filter.addressAndroidLight", "filter.addressTailscaleLight"],
    ["light", "filter.addressAndroidLight", "filter.addressTailscaleLight", "filter.addressAndroidStrong", "filter.addressTailscaleStrong"],
  ] as const)("says which phone the Android and Tailscale steps are for on a %s phone", (mode, android, tailscale, otherAndroid, otherTailscale) => {
    const t = makeT("en");
    const html = renderToStaticMarkup(<DnsAddress host="test-profile.dns.example.org" mode={mode} />);
    expect(html).toContain(t(android));
    expect(html).toContain(t(tailscale));
    expect(html).not.toContain(t(otherAndroid));
    expect(html).not.toContain(t(otherTailscale));
  });

  it("keeps the steps unscoped when the mode is unknown", () => {
    const html = renderToStaticMarkup(<DnsAddress host="test-profile.dns.example.org" />);
    expect(html).not.toContain("On this phone");
    expect(html).not.toContain("another Android phone or tablet. On this phone");
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

  it("copies the value associated with each button's accessible label", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const host = "test-profile.dns.example.org";
    renderToStaticMarkup(<DnsAddress host={host} />);

    const elements = [
      ...vi.mocked(jsxRuntime.jsx).mock.results,
      ...vi.mocked(jsxDevRuntime.jsxDEV).mock.results,
    ].map(({ value }) => value);
    for (const [label, address] of [
      ["Copy DNS-over-TLS hostname", host],
      ["Copy DNS-over-TLS address for clients that use tls://", `tls://${host}:853`],
    ]) {
      const button = elements.find((element) => element?.type === "button" && element.props["aria-label"] === label);
      expect(button).toBeDefined();
      button.props.onClick();
      expect(writeText).toHaveBeenCalledExactlyOnceWith(address);
      writeText.mockClear();
    }
  });
});
