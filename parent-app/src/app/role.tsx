// SPDX-License-Identifier: Apache-2.0
//
// "Whose phone is this?" on the first launch of an iPhone build with the Child role
// (docs/ios/architecture.md, "App roles"). Two answers; a parent's goes on to sign in as today.
import { useRouter } from "expo-router";
import { useState } from "react";
import { Button, Choice, PageTitle, Screen, Stack } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { useRole } from "../lib/role-context";
import type { AppRole } from "../lib/roles";

export default function RoleScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { choose } = useRole();
  const [role, setRole] = useState<Extract<AppRole, "parent" | "child">>("parent");
  const [busy, setBusy] = useState(false);
  return (
    <Screen testID="role">
      <PageTitle>{t("iphone.role.title")}</PageTitle>
      <Stack>
        <Choice
          label={t("iphone.role.title")}
          hideLabel
          value={role}
          onChange={setRole}
          options={[
            { value: "parent", label: t("iphone.role.parent"), help: t("iphone.role.parentHelp"), testID: "role-parent" },
            { value: "child", label: t("iphone.role.child"), help: t("iphone.role.childHelp"), testID: "role-child" },
          ]}
        />
        <Button
          testID="role-next"
          title={t("iphone.role.next")}
          busy={busy}
          onPress={() => {
            setBusy(true);
            void choose(role).then(() => router.replace(role === "child" ? "/child/setup" : "/login"));
          }}
        />
      </Stack>
    </Screen>
  );
}
