// SPDX-License-Identifier: Apache-2.0
//
// A tiny stand-in for the Plainphone API: routes "METHOD /path" to handlers and records
// every request, so tests can assert what the app sent.

export interface Call {
  method: string;
  path: string;
  body: unknown;
  auth: string | null;
}
type Handler = (call: Call) => { status?: number; body?: unknown } | undefined;

export function fakeApi(routes: Record<string, Handler | { status?: number; body?: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, "");
    const text = req.method === "GET" ? "" : await req.text();
    const call: Call = { method: req.method, path, body: text ? JSON.parse(text) : undefined, auth: req.headers.get("authorization") };
    calls.push(call);
    const key = `${req.method} ${path}`;
    const route = routes[key];
    const out = typeof route === "function" ? route(call) : route;
    if (!out) return new Response(JSON.stringify({ error: `no fake for ${key}` }), { status: 404 });
    const status = out.status ?? 200;
    return new Response(out.body === undefined ? null : JSON.stringify(out.body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  globalThis.fetch = fetchImpl as typeof fetch;
  return { calls };
}

export const ME = {
  user: { id: "u1", email: "parent@example.org", locale: "en" },
  households: [{ id: "00000000-0000-4000-8000-000000000001", name: "Home", role: "owner" }],
  mailEnabled: true,
};

export const PHONE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Alma",
  profile: "child",
  mode: "strong",
  timezone: "Europe/Copenhagen",
  locationEnabled: true,
  pairedAt: "2026-11-16T10:00:00Z",
  lastSeenAt: null,
  dnsHost: "abc.dns.plainphone.org",
  dnsSynced: true,
  hasLocation: false,
};
