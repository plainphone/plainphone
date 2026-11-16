// SPDX-License-Identifier: Apache-2.0
//
// "Scan the code" on the pairing screen, with the camera replaced by a stand-in.
import * as SecureStore from "expo-secure-store";
import { fireEvent, renderRouter, screen, act } from "expo-router/testing-library";
import { fakeApi, ME } from "../test/fakeApi";

let mockCamera: { onBarcodeScanned?: (r: { data: string }) => void; barcodeScannerSettings?: unknown } = {};
const mockPermission = { granted: false, canAskAgain: true };
const mockRequest = jest.fn(async () => ({ granted: mockPermission.granted }));
jest.mock("expo-camera", () => {
  const { View } = jest.requireActual("react-native");
  const React = jest.requireActual("react");
  return {
    CameraView: (props: typeof mockCamera) => {
      mockCamera = props;
      return React.createElement(View, { testID: "camera" });
    },
    useCameraPermissions: () => [mockPermission, mockRequest],
  };
});
jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

beforeEach(async () => {
  await SecureStore.setItemAsync("pp.session", "pp_s_saved");
  fakeApi({ "GET /me": { body: ME } });
  mockCamera = {};
  mockRequest.mockClear();
});

it("explains a refused camera and keeps the typed code as the way in", async () => {
  mockPermission.granted = false;
  await renderRouter("./src/app", { initialUrl: "/pair" });
  await fireEvent.press(await screen.findByTestId("scan-start"));
  expect(await screen.findByText(/Plainphone may not use the camera/)).toBeTruthy();
  expect(screen.queryByTestId("camera")).toBeNull();
  expect(screen.getByTestId("pair-code")).toBeTruthy();
});

it("reads a Plainphone QR code into the code field and ignores other QR codes", async () => {
  mockPermission.granted = true;
  await renderRouter("./src/app", { initialUrl: "/pair" });
  await fireEvent.press(await screen.findByTestId("scan-start"));
  expect(await screen.findByTestId("camera")).toBeTruthy();
  expect(mockCamera.barcodeScannerSettings).toEqual({ barcodeTypes: ["qr"] });

  // Someone else's QR code, seen many times: one message, camera stays on.
  await act(async () => {
    mockCamera.onBarcodeScanned?.({ data: "https://example.com/?code=K7MP4QXR" });
    mockCamera.onBarcodeScanned?.({ data: "https://example.com/?code=K7MP4QXR" });
  });
  expect(await screen.findAllByText(/That QR code is not from Plainphone/)).toHaveLength(1);
  expect(screen.getByTestId("camera")).toBeTruthy();

  await act(async () => {
    mockCamera.onBarcodeScanned?.({ data: "https://app.plainphone.org/pair?code=K7MP4QXR" });
  });
  expect(await screen.findByText("Code K7MP-4QXR scanned.")).toBeTruthy();
  expect(screen.getByTestId("pair-code").props.value).toBe("K7MP-4QXR");
  expect(screen.queryByTestId("camera")).toBeNull();
});
