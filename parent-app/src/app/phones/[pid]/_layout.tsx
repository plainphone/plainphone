// SPDX-License-Identifier: Apache-2.0
//
// Everything about one phone: the overview and its rule screens share the loaded phone,
// its waiting changes and the result bar (components/PhoneContext.tsx).
import { Stack, useLocalSearchParams } from "expo-router";
import { PhoneProvider, usePhoneName } from "../../../components/PhoneContext";
import { RequireAuth } from "../../../components/RequireAuth";
import { useStackOptions } from "../../../lib/stackOptions";

function PhoneStack() {
  const options = useStackOptions();
  const name = usePhoneName();
  return <Stack screenOptions={{ ...options, title: name }} />;
}

export default function PhoneLayout() {
  const { pid } = useLocalSearchParams<{ pid: string }>();
  return (
    <RequireAuth>
      <PhoneProvider pid={pid ?? ""}>
        <PhoneStack />
      </PhoneProvider>
    </RequireAuth>
  );
}
