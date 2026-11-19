// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { AddPhonePage } from "./AddPhone";

const phone = { id: "test-phone", name: "Test phone", mode: "light", pairedAt: null, setupEnrollmentId: "enr-1" };
const provisioning = {
  mode: "light",
  serverUrl: "https://my-plainphone.example.org",
  adminComponent: "org.plainphone.app/.PlainphoneAdminReceiver",
  downloadUrl: "https://my-plainphone.example.org/download/android",
  signatureChecksum: "test-checksum",
  dnsHost: "dns.example.org",
};

it("puts the first instruction before the code and restarts an expired code for the same phone", async () => {
  const tokens = ["pp_e_3q2-7wEvR1q8aZ0sLx9Ywg", "pp_e_9x8-AbCdEfGhIjKlMnOpQr"];
  const fetch = vi.fn(async (url: string, request: RequestInit) => {
    if (request.method === "GET") return Response.json(phone);
    const first = url === "/api/phones/enroll";
    // The first code is already about to run out.
    const expiresAt = new Date(Date.now() + (first ? 300 : 3_600_000)).toISOString();
    return Response.json({ phone, enrollment: { id: "enr-1", token: tokens[first ? 0 : 1], expiresAt }, provisioning }, { status: 201 });
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
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Test phone");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());

    const first = container.querySelector(".setup-first")!;
    const qr = container.querySelector(".qr")!;
    expect(first.textContent).toContain("Start here");
    expect(first.compareDocumentPosition(qr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(container.querySelector(".qr")).toBeNull();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("the same phone");

    const restart = [...container.querySelectorAll("button")].find((b) => b.textContent === "Create a new setup link")!;
    await act(async () => restart.click());
    expect(fetch).toHaveBeenCalledWith("/api/phones/test-phone/enrollment", expect.objectContaining({ method: "POST" }));
    expect(container.querySelector(".qr")).not.toBeNull();
    expect(container.querySelector("[role=alert]")).toBeNull();
    const link = [...container.querySelectorAll("a")].find((el) => el.textContent === "Open setup link")!;
    expect(link.href).toContain("9x8-AbCdEfGhIjKlMnOpQr");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    localStorage.removeItem("pp.locale");
    vi.unstubAllGlobals();
  }
});

it("shows the paired screen when restarting an expired code hits 409 because the phone paired", async () => {
  let paired = false;
  const fetch = vi.fn(async (url: string, request: RequestInit) => {
    if (request.method === "GET") return Response.json({ ...phone, pairedAt: paired ? "2026-01-01T00:00:00Z" : null });
    if (url === "/api/phones/enroll") {
      return Response.json({ phone, enrollment: { id: "enr-1", token: "pp_e_3q2-7wEvR1q8aZ0sLx9Ywg", expiresAt: new Date(Date.now() + 300).toISOString() }, provisioning }, { status: 201 });
    }
    paired = true;
    return Response.json({ error: "conflict" }, { status: 409 });
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
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Test phone");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    const restart = [...container.querySelectorAll("button")].find((b) => b.textContent === "Create a new setup link")!;
    expect(document.activeElement).toBe(restart);
    await act(async () => restart.click());
    expect(container.querySelector(".setup-done")).not.toBeNull();
    expect(container.querySelector("[role=alert]")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    localStorage.removeItem("pp.locale");
    vi.unstubAllGlobals();
  }
});
