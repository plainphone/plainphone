// SPDX-License-Identifier: Apache-2.0
//
// A short alarm tone for an SOS, made with Web Audio so there is no audio file to ship. Browsers
// block sound until the page has had a tap or key press; then this stays silent, by design.

/** Three rising beeps, about a second and a half. */
export function playSosTone(): void {
  try {
    const Ctx: typeof AudioContext | undefined =
      typeof AudioContext !== "undefined" ? AudioContext : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === "suspended") ctx.resume().catch(() => undefined);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime;
    gain.gain.setValueAtTime(0, t0);
    for (let i = 0; i < 3; i++) {
      const at = t0 + i * 0.5;
      osc.frequency.setValueAtTime(660 + i * 110, at);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.25, at + 0.03);
      gain.gain.setValueAtTime(0.25, at + 0.3);
      gain.gain.linearRampToValueAtTime(0, at + 0.38);
    }
    osc.onended = () => void ctx.close().catch(() => undefined);
    osc.start(t0);
    osc.stop(t0 + 1.5);
    // Still suspended a moment later: blocked. Drop it instead of playing late, on the first tap.
    setTimeout(() => {
      if (ctx.state !== "running") void ctx.close().catch(() => undefined);
    }, 300);
  } catch {
    // No sound is better than an error.
  }
}
