// SPDX-License-Identifier: Apache-2.0
import { useI18n } from "../i18n/I18n";
import { formatRelative } from "../lib/format";
import { phoneState, type PhoneStateInput } from "../lib/phone-state";

/** The one-line answer to "is this phone reachable and does it have my rules?". */
export function PhoneStateTitle({ phone, now }: { phone: PhoneStateInput; now: number }) {
  const { t, locale } = useI18n();
  const s = phoneState(phone, now);
  return (
    <span className={s.attention ? "phone-state phone-state-attention" : "phone-state"} data-state={s.state}>
      {t(s.title, { when: s.at ? formatRelative(s.at, now, locale) : "" })}
    </span>
  );
}

/** What the state means and what happens next, in a sentence. */
export function PhoneStateHint({ phone, now }: { phone: PhoneStateInput; now: number }) {
  const { t, locale } = useI18n();
  const s = phoneState(phone, now);
  return (
    <p className={s.attention ? "notice notice-warn" : "help"} data-state={s.state}>
      {t(s.hint, { when: s.at ? formatRelative(s.at, now, locale) : "" })}
    </p>
  );
}
