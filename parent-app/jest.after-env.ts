// SPDX-License-Identifier: Apache-2.0
// Every test starts signed out with an empty keychain.
beforeEach(() => {
  (jest.requireMock("expo-secure-store") as { __store: Map<string, string> }).__store.clear();
});
