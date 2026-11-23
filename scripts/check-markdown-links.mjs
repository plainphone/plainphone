#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Checks every relative link and #anchor in the repository's Markdown files the way GitHub
// renders them. External links (http, https, mailto, ...) are left alone: CI has no network.
// Usage: node scripts/check-markdown-links.mjs [file.md ...]   (default: every tracked *.md)

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** GitHub's heading anchor: lowercase, punctuation removed, each space becomes a hyphen. */
export function slug(text) {
  return plainText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

/** The heading text GitHub slugs: inline Markdown and HTML tags stripped. */
function plainText(text) {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .trim();
}

/** Lines outside fenced code blocks, with inline code spans blanked out. */
function proseLines(source) {
  const lines = [];
  let fence = null;
  source.split(/\r?\n/).forEach((line, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !/\S/.test(line.slice(marker[0].length))) fence = null;
    } else if (marker) {
      fence = marker[1];
    } else {
      lines.push({ number: index + 1, text: line.replace(/(`+)[^`].*?\1/g, (span) => " ".repeat(span.length)) });
    }
  });
  return lines;
}

/** Every anchor a file offers: headings (with GitHub's -1, -2 suffixes) and HTML id/name attributes. */
export function anchors(source) {
  const found = new Set();
  const counts = new Map();
  const add = (base) => {
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    found.add(seen ? `${base}-${seen}` : base);
  };
  const lines = proseLines(source);
  lines.forEach(({ text }, i) => {
    const atx = /^ {0,3}#{1,6}(?:\s+(.*?))?(?:\s+#+)?\s*$/.exec(text);
    const next = lines[i + 1];
    if (atx) add(slug(atx[1] ?? ""));
    else if (text.trim() && !/^\s*[-*>|]/.test(text) && next && next.number === lines[i].number + 1 && /^ {0,3}(=+|-{2,})\s*$/.test(next.text)) add(slug(text));
    for (const match of text.matchAll(/<[a-z][^>]*?\s(?:id|name)\s*=\s*["']([^"']+)["']/gi)) found.add(match[1]);
  });
  return found;
}

/** Link destinations in a file: inline links and images, reference definitions, HTML href/src. */
export function links(source) {
  const found = [];
  for (const { number, text } of proseLines(source)) {
    // Footnotes ([^1]: ...) are text, not link definitions.
    const definition = /^ {0,3}\[([^\]^][^\]]*)\]:\s*<?([^\s>]+)>?/.exec(text);
    if (definition) {
      found.push({ line: number, target: definition[2] });
      continue;
    }
    for (let at = text.indexOf("]("); at !== -1; at = text.indexOf("](", at + 2)) {
      const target = destination(text, at + 2);
      if (target !== null) found.push({ line: number, target });
    }
    for (const match of text.matchAll(/<(?:a|img|source)\b[^>]*?\s(?:href|src|srcset)\s*=\s*["']([^"']+)["']/gi)) {
      found.push({ line: number, target: match[1].split(/\s/)[0] });
    }
  }
  return found;
}

/** The destination of an inline link starting at `start`, or null when it is not one. */
function destination(text, start) {
  let rest = text.slice(start).trimStart();
  if (rest.startsWith("<")) {
    const end = rest.indexOf(">");
    return end === -1 ? null : rest.slice(1, end);
  }
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const char = rest[i];
    if (char === "\\") i++;
    else if (char === "(") depth++;
    else if (char === ")" && depth-- === 0) return rest.slice(0, i).split(/\s+/)[0];
    else if (/\s/.test(char) && depth === 0) return rest.slice(0, i);
  }
  return null;
}

/** Problems with the relative links in one Markdown file, as "file:line: message" strings. */
export function check(file, { root = ROOT, read = (path) => readFileSync(path, "utf8") } = {}) {
  const problems = [];
  const cache = new Map();
  const anchorsOf = (path) => {
    if (!cache.has(path)) cache.set(path, anchors(read(path)));
    return cache.get(path);
  };
  const source = read(file);
  for (const { line, target } of links(source)) {
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue;
    const hashAt = target.indexOf("#");
    const pathPart = hashAt === -1 ? target : target.slice(0, hashAt);
    const anchor = hashAt === -1 ? null : decode(target.slice(hashAt + 1));
    const cleanPath = decode(pathPart.split("?")[0]);
    const path = cleanPath === "" ? file : cleanPath.startsWith("/") ? join(root, cleanPath) : resolve(dirname(file), cleanPath);
    const where = `${relative(root, file)}:${line}`;
    if (!existsSync(path)) {
      problems.push(`${where}: ${target} -> ${relative(root, path)} does not exist`);
      continue;
    }
    // Line anchors (#L10, #L10-L20) on code files are GitHub's own; only Markdown has heading anchors.
    if (anchor === null || anchor === "" || !path.endsWith(".md") || statSync(path).isDirectory()) continue;
    if (!anchorsOf(path).has(anchor) && !anchorsOf(path).has(anchor.toLowerCase())) {
      problems.push(`${where}: ${target} -> no heading or id "${anchor}" in ${relative(root, path)}`);
    }
  }
  return problems;
}

function decode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function trackedMarkdown() {
  const output = execFileSync("git", ["ls-files", "-z", "--", "*.md"], { cwd: ROOT, encoding: "utf8" });
  return output.split("\0").filter(Boolean).map((path) => join(ROOT, path));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.length > 2 ? process.argv.slice(2).map((path) => resolve(path)) : trackedMarkdown();
  const problems = files.flatMap((file) => check(file));
  for (const problem of problems) console.error(problem);
  console.log(`${files.length} Markdown files checked, ${problems.length} broken links.`);
  process.exitCode = problems.length ? 1 : 0;
}
