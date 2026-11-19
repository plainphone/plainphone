// SPDX-License-Identifier: Apache-2.0
//
// Plainphone service worker. Caches the app shell only, so the app opens without a
// network. Never touches /api: rules and positions must always be live.

const VERSION = "pp-shell-v3";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/api") return;

  // Pages: network first, so a new release shows at once; the cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put("/", copy));
          }
          return res;
        })
        .catch(() => caches.match("/").then((r) => r || Response.error())),
    );
    return;
  }

  // Hashed build files never change: cache first.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Icons and the manifest: cache, refresh in the background.
  if (SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
  }
});

// Notifications (Web Push). The server encrypts each message for this browser only.
self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = {};
  }
  const title = msg.title || "Plainphone";
  // Action buttons (more-time requests): as many as this browser shows, in the order the server sent them.
  const max = typeof Notification !== "undefined" && Number.isInteger(Notification.maxActions) ? Notification.maxActions : 2;
  // A browser that shows fewer than four keeps "15 min" and "No" (a quick yes and a quick no); the page has the rest.
  const keep = ["15", "no", "60", "day"];
  const actions = Array.isArray(msg.actions)
    ? msg.actions
        .filter((a) => a && typeof a.id === "string" && typeof a.title === "string")
        .sort((a, b) => keep.indexOf(a.id) - keep.indexOf(b.id))
        .slice(0, max)
        .sort((a, b) => msg.actions.indexOf(a) - msg.actions.indexOf(b))
        .map((a) => ({ action: a.id, title: a.title }))
    : [];
  const data = {
    url: typeof msg.url === "string" && msg.url.startsWith("/") ? msg.url : "/",
    type: msg.data?.type,
    phoneId: msg.data?.phoneId,
    requestId: msg.data?.requestId,
  };
  event.waitUntil(
    self.registration.showNotification(title, {
      body: msg.body || "",
      // Same tag: a newer message about the same thing replaces the older one.
      tag: msg.tag || undefined,
      renotify: Boolean(msg.tag),
      requireInteraction: msg.data?.type === "sos-urgent",
      icon: "/icons/icon-192.png",
      // Android only reads the alpha of the badge: a white switch outline on transparent.
      badge: "/icons/badge-96.png",
      ...(actions.length > 0 ? { actions } : {}),
      data,
    }),
  );
});

const MORE_TIME_ANSWERS = ["15", "60", "day", "no"];

function openUrl(url) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) return open.focus().then((w) => (w && "navigate" in w ? w.navigate(url) : undefined));
    return self.clients.openWindow(url);
  });
}

// Answers a request for more time straight from the notification. The session cookie goes along
// (the worker cannot read localStorage). The server is idempotent: a second tap changes nothing.
function answerMoreTime(data, answer) {
  const path = `/api/phones/${encodeURIComponent(data.phoneId)}/more-time-requests/${encodeURIComponent(data.requestId)}/answer`;
  return fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ answer }),
  }).then((res) => {
    if (!res.ok) throw new Error(`answer failed: ${res.status}`);
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = new URL(data.url || "/", self.location.origin).href;
  const answer = event.action;
  if (data.type === "more-time" && MORE_TIME_ANSWERS.includes(answer) && data.phoneId && data.requestId) {
    // Not signed in or offline: open the phone page, where the parent can answer.
    event.waitUntil(answerMoreTime(data, answer).catch(() => openUrl(url)));
    return;
  }
  event.waitUntil(openUrl(url));
});

// The browser replaced the subscription (keys rotated or expired): register the new one.
self.addEventListener("pushsubscriptionchange", (event) => {
  const key = event.oldSubscription?.options?.applicationServerKey;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).then((sub) =>
      fetch("/api/notifications/subscriptions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: "web", ...sub.toJSON(), replaces: event.oldSubscription.endpoint }),
      }),
    ),
  );
});
