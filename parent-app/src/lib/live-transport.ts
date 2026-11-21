// SPDX-License-Identifier: Apache-2.0
//
// The live connection's transport for React Native, whose fetch cannot stream: an
// XMLHttpRequest whose growing responseText is read piece by piece into the shared SSE
// parser (src/shared/lib/live-events.ts). No extra package needed.
import { getSessionToken } from "../api/client";
import { SseParser, type Transport } from "../shared/lib/live-events";

/** responseText only ever grows, so the connection is renewed (LiveClient resumes) past this size. */
export const MAX_STREAM_CHARS = 1_000_000;

export interface XhrTransportOptions {
  maxChars?: number;
  /** Injected for tests. */
  createXhr?: () => XMLHttpRequest;
  token?: () => string | null;
}

export function xhrTransport(o: XhrTransportOptions = {}): Transport {
  const maxChars = o.maxChars ?? MAX_STREAM_CHARS;
  const createXhr = o.createXhr ?? (() => new XMLHttpRequest());
  const token = o.token ?? getSessionToken;
  return (url, h) => {
    const xhr = createXhr();
    let done = false;
    let opened = false;
    let read = 0;
    const parser = new SseParser((event, data, id) => {
      try {
        h.onMessage(event, data, id);
      } catch {
        // one bad message must not end the stream
      }
    });

    const fail = (status?: number) => {
      if (done) return;
      done = true;
      xhr.abort();
      h.onError(status);
    };

    const progress = () => {
      if (done) return;
      if (!opened && xhr.readyState >= 2) {
        if (xhr.status !== 200) return fail(xhr.status || undefined);
        opened = true;
        h.onOpen();
      }
      if (opened && xhr.readyState >= 3) {
        const text = xhr.responseText ?? "";
        // Only what is new since the last look.
        const fresh = text.slice(read);
        read = text.length;
        if (fresh) parser.push(fresh);
        if (read > maxChars) fail();
      }
    };

    xhr.open("GET", url);
    const auth = token();
    if (auth) xhr.setRequestHeader("Authorization", `Bearer ${auth}`);
    xhr.setRequestHeader("Accept", "text/event-stream");
    xhr.setRequestHeader("Cache-Control", "no-cache");
    xhr.timeout = 0;
    xhr.onreadystatechange = progress;
    xhr.onprogress = progress;
    xhr.onerror = () => fail();
    xhr.ontimeout = () => fail();
    // A stream that ends by itself is unexpected: report it so the client reconnects.
    xhr.onload = () => {
      progress();
      fail();
    };
    xhr.send();
    return () => {
      if (done) return;
      done = true;
      xhr.abort();
    };
  };
}
