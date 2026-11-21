// SPDX-License-Identifier: Apache-2.0
import { xhrTransport } from "../src/lib/live-transport";

/** Just enough of XMLHttpRequest: the test sets status/readyState/responseText and fires the handlers. */
class FakeXhr {
  readyState = 0;
  status = 0;
  responseText = "";
  timeout = -1;
  headers: Record<string, string> = {};
  method = "";
  url = "";
  aborted = 0;
  onreadystatechange: (() => void) | null = null;
  onprogress: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onload: (() => void) | null = null;
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  send() {}
  abort() { this.aborted++; }
  /** The server answered: headers arrived. */
  headersReceived(status: number) {
    this.status = status;
    this.readyState = 2;
    this.onreadystatechange?.();
  }
  /** `text` is the whole body so far, as responseText is. */
  body(text: string) {
    this.readyState = 3;
    this.responseText = text;
    this.onprogress?.();
    this.onreadystatechange?.();
  }
}

function setup(maxChars?: number) {
  const xhr = new FakeXhr();
  const messages: [string, string, string | undefined][] = [];
  const h = {
    onOpen: jest.fn(),
    onMessage: jest.fn((e: string, d: string, id: string | undefined) => void messages.push([e, d, id])),
    onError: jest.fn(),
  };
  const close = xhrTransport({ createXhr: () => xhr as unknown as XMLHttpRequest, token: () => "pp_s_test", maxChars })("https://pp.example.test/api/events?lastEventId=a-1", h);
  return { xhr, h, messages, close };
}

describe("xhrTransport", () => {
  it("opens a GET with the session token and an event-stream Accept header", () => {
    const { xhr } = setup();
    expect(xhr.method).toBe("GET");
    expect(xhr.url).toBe("https://pp.example.test/api/events?lastEventId=a-1");
    expect(xhr.headers.Authorization).toBe("Bearer pp_s_test");
    expect(xhr.headers.Accept).toBe("text/event-stream");
  });

  it("reports open on a 200 and feeds only the new part of responseText to the parser", () => {
    const { xhr, h, messages } = setup();
    xhr.headersReceived(200);
    expect(h.onOpen).toHaveBeenCalledTimes(1);
    const first = 'id: a-2\nevent: sos.created\ndata: {"phoneId":"p1","id":"s1"}\n\n';
    xhr.body(first);
    expect(messages).toEqual([["sos.created", '{"phoneId":"p1","id":"s1"}', "a-2"]]);
    // A message split over two chunks, and the first one is not parsed again.
    const second = "event: request.answered\ndata: {\"phoneId\":";
    xhr.body(first + second);
    expect(messages).toHaveLength(1);
    xhr.body(first + second + '"p1"}\n\n');
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual(["request.answered", '{"phoneId":"p1"}', undefined]);
    expect(h.onOpen).toHaveBeenCalledTimes(1);
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("reports a refusal with its status and does not open", () => {
    const { xhr, h, close } = setup();
    xhr.headersReceived(429);
    expect(h.onError).toHaveBeenCalledWith(429);
    expect(h.onOpen).not.toHaveBeenCalled();
    expect(xhr.aborted).toBe(1);
    close();
    expect(xhr.aborted).toBe(1);
  });

  it("reports network errors, timeouts and an unexpected end without a status", () => {
    for (const end of ["onerror", "ontimeout", "onload"] as const) {
      const { xhr, h } = setup();
      xhr.headersReceived(200);
      xhr[end]?.();
      expect(h.onError).toHaveBeenCalledWith(undefined);
      expect(h.onError).toHaveBeenCalledTimes(1);
    }
  });

  it("aborts on close and then says nothing more", () => {
    const { xhr, h, close } = setup();
    xhr.headersReceived(200);
    close();
    expect(xhr.aborted).toBe(1);
    xhr.onerror?.();
    xhr.body("event: ping\ndata: {}\n\n");
    expect(h.onError).not.toHaveBeenCalled();
    expect(h.onMessage).not.toHaveBeenCalled();
  });

  it("renews the connection once the response passes the size cap", () => {
    const { xhr, h, messages } = setup(100);
    xhr.headersReceived(200);
    const line = 'event: sos.updated\ndata: {"phoneId":"p1"}\n\n';
    xhr.body(line);
    expect(h.onError).not.toHaveBeenCalled();
    xhr.body(line + line + line);
    // The messages that came with the last chunk are still delivered before the reconnect.
    expect(messages).toHaveLength(3);
    expect(h.onError).toHaveBeenCalledWith(undefined);
    expect(xhr.aborted).toBe(1);
  });
});
