// SPDX-License-Identifier: Apache-2.0
import { codeFromScan, tokenFromUrl } from "../src/lib/links";
import { routeForPush } from "../src/lib/notifications";

describe("login and invite links", () => {
  it("reads the token from the fragment", () => {
    expect(tokenFromUrl("https://app.plainphone.org/auth/app#token=pp_m_abcdefghijkl")).toBe("pp_m_abcdefghijkl");
    expect(tokenFromUrl("https://app.plainphone.org/auth/app#token=pp_m_a%2Bb%3Dcdefghij")).toBe("pp_m_a+b=cdefghij");
  });
  it("ignores links without a usable token", () => {
    expect(tokenFromUrl(null)).toBeNull();
    expect(tokenFromUrl("https://app.plainphone.org/auth/app")).toBeNull();
    expect(tokenFromUrl("https://app.plainphone.org/auth/app?token=pp_m_abcdefghijkl")).toBeNull();
    expect(tokenFromUrl("https://app.plainphone.org/auth/app#token=short")).toBeNull();
  });
});

describe("scanning the pairing QR code", () => {
  it("accepts the phone's pairing URL and bare codes", () => {
    expect(codeFromScan("https://app.plainphone.org/pair?code=K7MP4QXR")).toBe("K7MP4QXR");
    expect(codeFromScan("https://self.example/pair/?code=k7mp-4qxr")).toBe("K7MP4QXR");
    expect(codeFromScan(" k7mp-4qxr ")).toBe("K7MP4QXR");
  });
  it("rejects other QR codes", () => {
    expect(codeFromScan("https://example.com/?code=K7MP4QXR")).toBeNull();
    expect(codeFromScan("https://app.plainphone.org/pair")).toBeNull();
    expect(codeFromScan("WIFI:S:home;T:WPA;P:secret;;")).toBeNull();
    expect(codeFromScan("K7MP4")).toBeNull();
  });
});

describe("push notifications", () => {
  const pid = "11111111-1111-4111-8111-111111111111";
  it("opens the phone for a waiting change, or the approvals list", () => {
    expect(routeForPush({ type: "approval", phoneId: pid })).toEqual({ pathname: "/phones/[pid]", params: { pid } });
    expect(routeForPush({ type: "approval" })).toBe("/approvals");
  });
  it("opens the location screen when a position is ready", () => {
    expect(routeForPush({ type: "location", phoneId: pid })).toEqual({ pathname: "/phones/[pid]/location", params: { pid } });
  });
  it("never follows an unexpected payload", () => {
    expect(routeForPush({ type: "location", phoneId: "../../settings" })).toBe("/");
    expect(routeForPush(null)).toBe("/");
  });
});
