// SPDX-License-Identifier: Apache-2.0
//
// Settings → Live updates: two switches that belong to this device.

import { useI18n } from "../i18n/I18n";
import { LIVE_KEY, SOS_SOUND_KEY, useLiveSetting } from "../lib/live-settings";
import { Switch } from "./ui";

export function LiveSettings() {
  const { t } = useI18n();
  const [live, setLive] = useLiveSetting(LIVE_KEY);
  const [sound, setSound] = useLiveSetting(SOS_SOUND_KEY);
  return (
    <section className="section" aria-labelledby="live-h">
      <h2 id="live-h">{t("live.title")}</h2>
      <p className="muted">{t("live.intro")}</p>
      <Switch checked={live} onChange={setLive} label={t("live.switch")} description={t("live.switchHelp")} />
      <Switch checked={sound} onChange={setSound} label={t("live.sound")} description={t("live.soundHelp")} />
    </section>
  );
}
