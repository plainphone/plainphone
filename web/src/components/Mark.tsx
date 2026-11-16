// SPDX-License-Identifier: Apache-2.0
//
// The Plainphone mark: a phone with one calm wave. Same drawing as public/icon.svg.

export function Mark({ className = "mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect className="mark-bg" width="64" height="64" rx="16" />
      <rect className="mark-line" x="19" y="10" width="26" height="44" rx="7" fill="none" strokeWidth="4" />
      <path className="mark-line" d="M24.5 33c2.5-2.6 5-2.6 7.5 0s5 2.6 7.5 0" fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
