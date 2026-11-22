// SPDX-License-Identifier: Apache-2.0
//
// The sign-in form's bot check (docs/operations.md, "Bot and spam protection"). When the server
// asks for it (/api/health `botChallenge: "altcha"`), the page fetches a puzzle and solves it in
// the background as soon as it opens, so by the time the address is typed the answer is usually
// ready and nobody waits or clicks anything. No cookies, no third party.

import { type AltchaChallenge, AltchaAborted, solveAltcha } from "@plainphone/shared/altcha";
import { useCallback, useEffect, useRef, useState } from "react";

export interface SignInProtection {
  botChallenge: boolean;
  honeypot: boolean;
}

/** What the server asks of the sign-in form. Unknown (old server, offline): nothing. */
export async function signInProtection(): Promise<SignInProtection> {
  try {
    const res = await fetch("/api/health", { credentials: "same-origin" });
    const j = (await res.json()) as { botChallenge?: string; honeypot?: boolean };
    return { botChallenge: j.botChallenge === "altcha", honeypot: j.honeypot === true };
  } catch {
    return { botChallenge: false, honeypot: false };
  }
}

async function fetchChallenge(): Promise<AltchaChallenge> {
  const res = await fetch("/api/auth/challenge", { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) throw new Error(`challenge ${res.status}`);
  return (await res.json()) as AltchaChallenge;
}

/** A solution is used well before the server's 10 minutes run out. */
const FRESH_MS = 8 * 60_000;

export type BotCheckState = "off" | "working" | "ready" | "failed";

/**
 * Solves the server's puzzle in the background while `enabled`. `take()` waits for the answer,
 * or gives undefined when no check is needed. `take(true)` solves one anyway, for a server that
 * switched the check on after the page read /api/health. Each answer is handed out once.
 */
export function useBotCheck(enabled: boolean) {
  const [state, setState] = useState<BotCheckState>("off");
  const job = useRef<{ at: number; answer: Promise<string>; abort: AbortController } | null>(null);
  const used = useRef<Promise<string> | null>(null);

  const start = useCallback(() => {
    job.current?.abort.abort();
    const abort = new AbortController();
    setState("working");
    const answer = fetchChallenge().then((c) => solveAltcha(c, { signal: abort.signal }));
    job.current = { at: Date.now(), answer, abort };
    answer.then(
      () => { if (job.current?.answer === answer) setState("ready"); },
      (err: unknown) => { if (!(err instanceof AltchaAborted) && job.current?.answer === answer) setState("failed"); },
    );
  }, []);

  useEffect(() => {
    if (!enabled) return;
    start();
    return () => job.current?.abort.abort();
  }, [enabled, start]);

  const take = useCallback(async (force = false): Promise<string | undefined> => {
    if (!enabled && !force) return undefined;
    // Single use: a second submit (another address, "try again") solves a fresh one.
    if (!job.current || used.current === job.current.answer || Date.now() - job.current.at > FRESH_MS || state === "failed") start();
    const answer = job.current!.answer;
    used.current = answer;
    return answer;
  }, [enabled, start, state]);

  return { state, take, retry: start };
}
