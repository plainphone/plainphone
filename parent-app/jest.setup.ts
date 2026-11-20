// SPDX-License-Identifier: Apache-2.0
// In-memory Keychain/Keystore for tests.
const mockStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
  __store: mockStore,
}));
jest.mock("expo-localization", () => ({
  getLocales: () => [{ languageTag: "en-GB", languageCode: "en" }],
}));
// Notifications: no permission prompt, no tapped notification at start.
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  getDevicePushTokenAsync: jest.fn(async () => ({ type: "android", data: "fcm-token" })),
  setNotificationCategoryAsync: jest.fn(async () => null),
  dismissNotificationAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  dismissAllNotificationsAsync: jest.fn(async () => undefined),
  clearLastNotificationResponse: jest.fn(),
  getLastNotificationResponse: jest.fn(() => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
}));
