// SPDX-License-Identifier: Apache-2.0
//
// The Plainphone mark: an upright switch that is also a phone with one round button.
// Same drawing as docs/brand/directions/c/mark.svg (light) and mark-dark.svg (dark, no edge).

export function Mark({ className = "mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect className="mark-body" x="19" y="5" width="26" height="54" rx="13" strokeWidth="4" />
      <circle className="mark-knob" cx="32" cy="45" r="7.5" />
    </svg>
  );
}
