// SPDX-License-Identifier: Apache-2.0
//
// Copy that only the native app needs. Shared copy lives in src/shared/i18n (synced
// from the PWA). Every key here must exist in app-da.ts (the type enforces it).
// Never use em dashes in copy.

export const appEn = {
  "native.sentBody": "If {email} can be used here, a login link is on its way. Open it on this phone, and Plainphone opens by itself. The link works for 15 minutes.",
  "native.settings": "Settings",
  "native.server": "Server",
  "native.serverHelp": "This app talks to {host}.",
  "native.version": "Version {version}",
  "native.notifications": "Notifications",
  "native.notificationsHelp": "Get a notification when a change waits for your approval or a position is ready.",
  "native.notificationsOn": "Notifications are on.",
  "native.notificationsOff": "Notifications are off. You can turn them on in the phone's settings.",
  "native.notificationsAsk": "Turn on notifications",
  "native.notificationsLater": "Push delivery from the server is not switched on yet. The app is ready for it.",
  "native.scan": "Scan the code",
  "native.scanHelp": "Point the camera at the QR code on the phone.",
  "native.scanStop": "Stop scanning",
  "native.scanDenied": "Plainphone may not use the camera. Type the code instead, or allow the camera in the phone's settings.",
  "native.scanWrong": "That QR code is not from Plainphone. Scan the code on the phone you are adding.",
  "native.scanned": "Code {code} scanned.",
  "native.typeCode": "Or type the code",
  "native.openInMaps": "Open in Maps",
  "native.mapLabel": "Map showing the phone's last position.",
  "native.showMap": "Show map",
  "native.hideMap": "Hide map",
  "native.mapPrivacy": "The map comes from OpenStreetMap, whose servers then see roughly where the phone is. Plainphone shares nothing else. This choice is kept on this device.",
  "native.mapCredit": "Map data © OpenStreetMap contributors",
  "native.more": "More",
  "native.shareLink": "Share link",
  "native.timeHelp": "24-hour clock, like 08:00 or 21:30.",
  "native.manage": "Manage this phone",
  "native.renameTitle": "Rename",
  "native.renamed": "The phone is now called {name}.",
  "native.removePhone": "Remove this phone",
  "native.removeBody": "Remove {name} from Plainphone? Its rules and web filter are deleted. The lock on the phone stays until it is released on the phone itself.",
  "native.removeSelfNote": "This is your own phone, so removing it waits for your key like any loosening.",
  "native.removeYes": "Yes, remove",
  "native.removed": "{name} was removed.",
} as const;

export type AppMessageKey = keyof typeof appEn;
export type AppMessages = Record<AppMessageKey, string>;
