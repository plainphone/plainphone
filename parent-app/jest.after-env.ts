// SPDX-License-Identifier: Apache-2.0
import { AppState } from "react-native";
// Every test starts signed out with an empty keychain.
beforeEach(() => {
  (jest.requireMock("expo-secure-store") as { __store: Map<string, string> }).__store.clear();
});

beforeEach(() => {
  jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });
});
