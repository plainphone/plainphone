// SPDX-License-Identifier: Apache-2.0
//
// "Add an iPhone" (docs/ios/architecture.md, phase 1). Shown only while the server pairs iPhones.
// The iPhone asks the same question, "Whose phone is this?", then shows a code and a QR code,
// which the pairing screen reads.
import { useRouter } from "expo-router";
import { useState } from "react";
import { Linking } from "react-native";
import type { Profile } from "../api/models";
import { RequireAuth } from "../components/RequireAuth";
import { Button, Choice, LinkRow, Notice, PageTitle, Screen, Stack, Text } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { useIosPairing } from "../lib/session";
import { APPLE_SCREEN_TIME_HELP } from "@plainphone/shared/platform";

export function AddIphone() {
  const { t } = useI18n();
  const router = useRouter();
  const iosPairing = useIosPairing();
  const [profile, setProfile] = useState<Profile>("child");
  if (!iosPairing) {
    return (
      <Screen testID="add-iphone">
        <PageTitle>{t("platform.iphone.addTitle")}</PageTitle>
        <Notice tone="info" text={t("platform.iphone.notYet")} />
      </Screen>
    );
  }
  const needs = [
    ...(profile === "child" ? [t("platform.iphone.needFamily"), t("platform.iphone.needAccount")] : []),
    t("platform.iphone.needScreenTime"),
  ];
  return (
    <Screen testID="add-iphone">
      <PageTitle>{t("platform.iphone.addTitle")}</PageTitle>
      <Stack>
        <Choice<Profile>
          testID="add-iphone-role"
          label={t("platform.iphone.who")}
          value={profile}
          onChange={setProfile}
          options={[
            { value: "child", label: t("profile.child"), help: t("profile.childHelp"), testID: "add-iphone-child" },
            { value: "self", label: t("profile.self"), help: t("profile.selfHelp"), testID: "add-iphone-self" },
          ]}
        />
        <Text variant="heading">{t("platform.iphone.needs")}</Text>
        {needs.map((need) => <Text key={need} testID="add-iphone-need">{`• ${need}`}</Text>)}
        <LinkRow title={t("platform.iphone.needHelp")} onPress={() => void Linking.openURL(APPLE_SCREEN_TIME_HELP)} testID="add-iphone-help" />
        <Text>{t("platform.iphone.steps")}</Text>
        <Text variant="muted">{t("platform.iphone.scan")}</Text>
        <Button
          testID="add-iphone-next"
          title={t("platform.iphone.next")}
          onPress={() => router.push({ pathname: "/pair", params: { profile } })}
        />
      </Stack>
    </Screen>
  );
}

export default function AddIphoneScreen() {
  return (
    <RequireAuth>
      <AddIphone />
    </RequireAuth>
  );
}
