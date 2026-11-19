// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { encode } from "uqr";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { lightSetupIntent } from "../lib/light-setup";
import { AddPhonePage } from "./AddPhone";

it("puts the custom origin returned by enrollment in the Light setup link and QR", async () => {
  const origin = "https://my-plainphone.example.org:8443";
  const enrollment = { token: "pp_e_3q2-7wEvR1q8aZ0sLx9Ywg", expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
  const phone = { id: "test-phone", name: "Test phone", mode: "light", pairedAt: null };
  const fetch = vi.fn(async (_url: string, request: RequestInit) => {
    if (request.method === "GET") return Response.json(phone);
    return Response.json({
      phone, enrollment,
      provisioning: {
        serverUrl: origin,
        adminComponent: "org.plainphone.app/.PlainphoneAdminReceiver",
        downloadUrl: origin + "/download/android",
        signatureChecksum: "test-checksum",
        dnsHost: "dns.example.org",
      },
    }, { status: 201 });
  });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("pp.locale", "en");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <MemoryRouter initialEntries={["/add?mode=light"]}>
        <I18nProvider><AddPhonePage /></I18nProvider>
      </MemoryRouter>,
    ));
    const field = container.querySelector<HTMLInputElement>('input[name="name"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(field, "Test phone");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
    expect(fetch).toHaveBeenCalledWith("/api/phones/enroll", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"mode":"light"'),
    }));
    const link = [...container.querySelectorAll("a")].find((el) => el.textContent === "Open setup link");
    expect(link).toBeDefined();
    const url = new URL(link!.href);
    expect(url.origin).toBe(origin);
    expect(lightSetupIntent(url)).toContain(`&server=${encodeURIComponent(origin)}#Intent;`);
    const expectedModules = encode(url.href, { ecc: "L", border: 0 }).data;
    const expectedPath = expectedModules.flatMap((row, y) =>
      row.flatMap((on, x) => on ? [`M${x + 4} ${y + 4}h1v1h-1z`] : []),
    ).join("");
    expect(container.querySelector("svg[role=img] path")?.getAttribute("d")).toBe(expectedPath);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    localStorage.removeItem("pp.locale");
    vi.unstubAllGlobals();
  }
});
