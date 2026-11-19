# Open mode: every app, except what you block

Open mode turns the app rules around. Instead of "only the apps I allow open", it is "every app opens,
also new ones, except the ones I block". It suits an adult on a Myself phone, who does not want to approve
every app but does want social media, gambling and adult websites kept out. A child phone can use it too, but
it starts off there.

## What it does

- **Allow by default.** Every installed app is allowed, including apps installed after the last sync.
  Only apps on the **block list** are sent home (light mode) or hidden (strong mode).
- **Block one app.** Switch the app off in the Apps list. It goes on the block list at once.
- **Block a category.** Choosing **Social media** puts the known social apps on the block list *and* turns
  on the `social` category of the web filter, in one action. **Gambling** does the same. **Adult content**
  is web filter only, because there are no apps to close. The lists are in
  [`server/src/lib/open-mode.ts`](../server/src/lib/open-mode.ts) and are checked against Google Play.
  They are short on purpose: the web filter does the broad work, and any other app can be blocked one by one.
- **Defaults.** On for a new Myself phone, off for a child phone. A new Myself phone starts with social
  media and gambling blocked (apps and websites), like the web filter, whose categories all start blocked.
  Existing phones keep how they are until you change them.
- **Summary.** The Apps page opens with one line, for example *Open: everything is allowed except social
  media, adult content and Notes.* Each switch has a one-line explanation.

Everything can be turned on and off. Phone, messages and the other core apps are never on the block list,
and 112 and the parents' reachability do not depend on any of this.

## Tightening and loosening

| Change | Child phone | Myself phone |
|---|---|---|
| Block an app or a category | at once | at once |
| Turn open mode off (back to the allow-list) | at once | at once, but through the key if the allow-list would show an app that open mode blocks |
| Unblock an app or allow a category | at once | through the key (delay, buddy or QR approval) |
| Turn open mode on | at once | through the key |

On a Myself phone the pending change shows in the approval list in plain words, for example *Allow social
media (apps and websites)*. See [Self keys](self-keys.md).

An app that is blocked because its category is blocked cannot be unblocked on its own. Allow the category
instead, or block the other apps one by one.

## Works with Tailscale and other VPNs

Open mode only changes which apps open. The web filter underneath can use the **Private DNS** method, which
keeps the Android VPN slot free, so Tailscale or a work VPN can run next to the filter. See
[light mode](light-mode.md#tailscale-and-work-vpns). The DNS categories of a category block are the same
ones as in the Web filter page.

## Rules document

`GET /device/rules` carries `apps.open` and `apps.blocked` ([sync API](sync-api.md)). With `open: true` the
phone allows every app that is not in `blocked`, also apps the rules have never listed. `blocked` also names
the known apps of blocked categories that are not installed yet. `apps.allowed` and `apps.hidden` still list
the installed apps, so older phones keep working: they follow the allow-list for the apps they know.
A school time or bedtime window wins over open mode: during a window only the window's list is allowed.

## API

- `GET /phones/{pid}/open-mode`: `{ enabled, categories: [{ category, blocked, hasApps }], blockedApps }`
- `PUT /phones/{pid}/open-mode` with `{ enabled }`
- `PUT /phones/{pid}/open-mode/categories/{category}` with `{ blocked }`, for `social`, `gambling` and `adult`
- `PUT /phones/{pid}/apps/{package}` blocks or allows one app. `GET /phones/{pid}/apps` adds `blocked` and,
  when only a category blocks the app, `blockedBy`.

Storage: `phones.open_mode` and `phones.blocked_app_categories` (migration `0036_open_mode`). Single apps use
the existing `phone_apps.explicitly_blocked`.

## Limits

- A newly installed app on the block list can open for a moment until Plainphone has synced the new package.
  Installing triggers a sync at once, so this is seconds. In light mode apps are closed after they open, not hidden.
- The known-app lists cannot cover every betting or social app. Use the web filter category and block the
  rest one by one.

Evidence: no direct evidence, reason: this is an adult's own choice of what to keep out of their phone. It
follows the design principles in [design-principles.md](design-principles.md): the phone owner sees the block
list, nothing is hidden, and loosening goes through the key they set up themselves.
