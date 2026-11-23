// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { useI18n } from "../i18n/I18n";
import { api, type ChangeResult } from "../lib/api";
import { usePhone } from "../pages/Phone";
import { Switch } from "./ui";

export function ServerMoveToggle() {
  const { t } = useI18n();
  const { phone, pending, run, setPhone } = usePhone();
  const [working, setWorking] = useState(false);
  const value = phone.allowServerMove ?? phone.profile === "child";
  const waiting = pending.some((change) => change.op.type === "move.allow");

  async function update(allowed: boolean) {
    setWorking(true);
    try {
      const result = await run(() => api.put<ChangeResult>(`/phones/${phone.id}/server-move/allow`, { allowed }), t("move.allowed"));
      if (result?.status === "applied") setPhone({ ...phone, allowServerMove: allowed });
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="section panel">
      <Switch label={t("move.allow")} description={t("move.help")} checked={value} disabled={waiting} busy={working}
        onChange={(allowed) => void update(allowed)} />
    </section>
  );
}
