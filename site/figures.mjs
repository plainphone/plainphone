// SPDX-License-Identifier: Apache-2.0
// Schematic phone drawings for the setup guide: inline SVG, no photos. Colours come from the
// page's CSS custom properties through the .f-* classes in src/style.css, so light and dark mode
// follow the page. The text inside a drawing is a few short button labels, passed in by the caller.
const W = 168; // phone width
const H = 304; // phone height
const SW = 150; // screen width
const SH = 286; // screen height

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const bar = (x, y, w, cls = "f-bar", h = 7) => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/>`;

// One phone at (x, 8). `screen` is drawn in a 150 x 286 box.
function phone(x, screen) {
  return `<g transform="translate(${x} 8)">
<rect class="f-body" x="1.25" y="1.25" width="${W - 2.5}" height="${H - 2.5}" rx="28"/>
<rect class="f-screen" x="9" y="9" width="${SW}" height="${SH}" rx="20"/>
<rect class="f-ink" x="${9 + SW / 2 - 12}" y="16" width="24" height="5" rx="2.5"/>
<g transform="translate(9 9)">${screen}</g>
</g>`;
}

function svg(width, alt, body) {
  return `<svg class="drawing${width > 200 ? " wide" : ""}" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H + 16}" viewBox="0 0 ${width} ${H + 16}" role="img" aria-label="${esc(alt)}" focusable="false">${body}</svg>`;
}

// Settings list, the fourth row marked: "Erase all data".
function resetScreen() {
  const rows = [0, 1, 2, 3, 4].map((i) => {
    const y = 52 + i * 46;
    const on = i === 3;
    const widths = [74, 58, 86, 72, 64];
    return `${on ? `<rect class="f-mark" x="6" y="${y}" width="138" height="38" rx="10"/>` : ""}<circle class="${on ? "f-ink" : "f-bar-d"}" cx="24" cy="${y + 19}" r="7"/>${bar(42, y + 15, widths[i], on ? "f-ink" : "f-bar", 8)}`;
  });
  return `${bar(14, 30, 64, "f-bar-d", 9)}${rows.join("")}`;
}

// First welcome screen with the six taps in an empty spot between the language button and Start.
function welcomeScreen(taps) {
  return `<circle class="f-line" cx="75" cy="62" r="20"/>
${bar(33, 100, 84, "f-bar-d", 10)}${bar(24, 120, 102)}${bar(42, 134, 66)}
<rect class="f-line thin" x="25" y="156" width="100" height="26" rx="13"/>
<rect class="f-bar" x="20" y="250" width="110" height="26" rx="13"/>
<circle class="f-mark" cx="75" cy="216" r="9"/>
<circle class="f-line" cx="75" cy="216" r="16"/>
<circle class="f-line thin" cx="75" cy="216" r="23"/>
<rect class="f-mark" x="104" y="204" width="40" height="25" rx="12.5"/>
<text class="f-txt tap" x="124" y="222" text-anchor="middle">${esc(taps)}</text>`;
}

// QR reader: four corner brackets around a stylised code, and a scan line.
function scanScreen() {
  const c = 18; // corner length
  const [x0, y0, x1, y1] = [22, 78, 128, 184];
  const corners = `<path class="f-line bracket" d="M${x0} ${y0 + c}V${y0}H${x0 + c}M${x1 - c} ${y0}H${x1}V${y0 + c}M${x1} ${y1 - c}V${y1}H${x1 - c}M${x0 + c} ${y1}H${x0}V${y1 - c}"/>`;
  // The code: three finder squares and loose modules on a 9 x 9 grid of 8 px cells.
  const [ox, oy] = [39, 95];
  const finder = (cx, cy) => `<rect class="f-line" x="${ox + cx * 8 + 1}" y="${oy + cy * 8 + 1}" width="22" height="22" rx="2"/><rect class="f-ink" x="${ox + cx * 8 + 8}" y="${oy + cy * 8 + 8}" width="8" height="8"/>`;
  const modules = [
    [4, 0], [3, 1], [5, 1], [4, 2], [1, 3], [3, 3], [6, 3], [8, 3], [2, 4], [4, 4], [7, 4], [0, 5],
    [3, 5], [5, 5], [8, 5], [4, 6], [6, 6], [3, 7], [5, 7], [7, 7], [4, 8], [8, 8],
  ]
    .map(([cx, cy]) => `<rect class="f-ink" x="${ox + cx * 8 + 1}" y="${oy + cy * 8 + 1}" width="6" height="6"/>`)
    .join("");
  return `${corners}${finder(0, 0)}${finder(6, 0)}${finder(0, 6)}${modules}
<rect class="f-mark" x="22" y="129" width="106" height="4" rx="2"/>
${bar(46, 214, 58)}`;
}

// A Wi-Fi list, one network chosen.
function wifiScreen() {
  const arc = (cx, cy, r) => `M${(cx - r * 0.7071).toFixed(2)} ${(cy - r * 0.7071).toFixed(2)}A${r} ${r} 0 0 1 ${(cx + r * 0.7071).toFixed(2)} ${(cy - r * 0.7071).toFixed(2)}`;
  const rows = [0, 1, 2, 3, 4].map((i) => {
    const y = 52 + i * 46;
    const on = i === 1;
    const cx = 25;
    const cy = y + 25;
    const widths = [62, 78, 54, 70, 48];
    return `${on ? `<rect class="f-mark" x="6" y="${y}" width="138" height="38" rx="10"/>` : ""}<g class="${on ? "f-ink-line" : "f-pencil-line"}"><path d="${arc(cx, cy, 6)} ${arc(cx, cy, 11)} ${arc(cx, cy, 16)}"/><circle cx="${cx}" cy="${cy}" r="1.8"/></g>${bar(48, y + 15, widths[i], on ? "f-ink" : "f-bar", 8)}`;
  });
  return `${bar(14, 30, 56, "f-bar-d", 9)}${rows.join("")}`;
}

// Android's "Set Plainphone as your default phone app?" dialog, two buttons.
function dialogScreen(set, cancel) {
  return `${bar(14, 30, 48, "f-bar-d", 9)}${bar(14, 54, 122)}${bar(14, 68, 96)}
<rect class="f-dialog" x="7" y="86" width="136" height="156" rx="14"/>
${bar(20, 104, 108, "f-bar-d", 8)}${bar(20, 119, 78, "f-bar-d", 8)}
<rect class="f-ink" x="18" y="146" width="114" height="34" rx="17"/>
<text class="f-txt on-ink" x="75" y="167.5" text-anchor="middle">${esc(set)}</text>
<rect class="f-line thin" x="18" y="192" width="114" height="34" rx="17"/>
<text class="f-txt" x="75" y="213.5" text-anchor="middle">${esc(cancel)}</text>`;
}

const arrow = (x) => `<path class="f-line" d="M${x - 4} ${H / 2 - 4}l9 12l-9 12"/>`;

export function figures({ taps, set, cancel, alt }) {
  const single = 184;
  const double = 8 + W + 44 + W + 8;
  return {
    reset: svg(single, alt.reset, phone(8, resetScreen())),
    welcome: svg(single, alt.welcome, phone(8, welcomeScreen(taps))),
    scan: svg(double, alt.scan, `${phone(8, scanScreen())}${arrow(8 + W + 22)}${phone(8 + W + 44, wifiScreen())}`),
    dialog: svg(single, alt.dialog, phone(8, dialogScreen(set, cancel))),
  };
}
