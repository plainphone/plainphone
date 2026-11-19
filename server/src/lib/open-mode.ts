// SPDX-License-Identifier: Apache-2.0
//
// Open mode (docs/open-mode.md): every app is allowed, also new ones, except the block list.
// A blocked category puts its known apps on the block list and turns on the matching DNS
// category in one action. The lists are short and checked against Google Play; the DNS
// category does the broad work, and any other app can be blocked one by one.

export const OPEN_CATEGORIES = ["social", "gambling", "adult"] as const;
export type OpenCategory = (typeof OPEN_CATEGORIES)[number];

/** The categories that also have apps. "adult" is DNS only. */
export const APP_CATEGORIES = ["social", "gambling"] as const;
export type AppCategory = (typeof APP_CATEGORIES)[number];

export const CATEGORY_APPS: Record<AppCategory, readonly string[]> = {
  social: [
    "com.instagram.android",
    "com.instagram.barcelona", // Threads
    "com.zhiliaoapp.musically", // TikTok
    "com.facebook.katana",
    "com.facebook.lite",
    "com.snapchat.android",
    "com.twitter.android", // X
    "com.reddit.frontpage",
    "com.bereal.ft",
    "com.tumblr",
    "com.pinterest",
  ],
  gambling: ["com.draftkings.sportsbook", "com.draftkings.casino", "com.fanduel.sportsbook", "com.fanduel.casino"],
};

export function isAppCategory(category: string): category is AppCategory {
  return (APP_CATEGORIES as readonly string[]).includes(category);
}

/** The blocked app category that blocks a package, if any. */
export function categoryOf(packageName: string, categories: readonly string[]): AppCategory | undefined {
  return APP_CATEGORIES.find((c) => categories.includes(c) && CATEGORY_APPS[c].includes(packageName));
}

/** Every package that the blocked app categories put on the block list, sorted. */
export function categoryPackages(categories: readonly string[]): string[] {
  const out = new Set<string>();
  for (const c of categories) if (isAppCategory(c)) for (const p of CATEGORY_APPS[c]) out.add(p);
  return [...out].sort();
}
