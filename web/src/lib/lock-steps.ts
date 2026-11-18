// SPDX-License-Identifier: Apache-2.0
import type { MessageKey, T } from "../i18n/translate";
import type { Locale } from "./api";
import { failedPolicyLabel } from "./failedPolicies";
import { SETTING_SPECS, settingName } from "./settings";

// Names reported by Android's PolicyApplier, SettingsApplier and LightLock.
const stepKeys = new Map<string, MessageKey>([
  ["device owner", "lockStep.owner"],
  ["default phone app", "lockStep.dialer"],
  ["default SMS app", "lockStep.sms"],
  ["restriction no_install_apps", "lockStep.install"],
  ["restriction no_install_unknown_sources", "lockStep.unknownSources"],
  ["restriction no_install_unknown_sources_globally", "lockStep.unknownSourcesAll"],
  ["restriction no_factory_reset", "lockStep.reset"],
  ["restriction no_safe_boot", "lockStep.safeBoot"],
  ["restriction no_add_user", "lockStep.addUser"],
  ["restriction no_user_switch", "lockStep.switchUser"],
  ["restriction no_add_managed_profile", "lockStep.workProfile"],
  ["restriction no_add_clone_profile", "lockStep.cloneProfile"],
  ["restriction no_add_private_profile", "lockStep.privateProfile"],
  ["restriction no_debugging_features", "lockStep.debugging"],
  ["restriction disallow_config_private_dns", "lockStep.filterSettings"],
  ["restriction no_config_vpn", "lockStep.vpnSettings"],
  ["restriction no_network_reset", "lockStep.networkReset"],
  ["restriction no_config_credentials", "lockStep.certificates"],
  ["restriction no_usb_file_transfer", "lockStep.usb"],
  ["restriction no_physical_media", "lockStep.storage"],
  ["restriction no_config_date_time", "lockStep.clockSettings"],
  ["restriction disallow_config_default_apps", "lockStep.defaultApps"],
  ["block uninstall of Plainphone", "lockStep.uninstall"],
  ["automatic date and time", "lockStep.clock"],
  ["phone and SMS permissions", "lockStep.permissions"],
  ["location setting free", "lockStep.locationFree"],
  ["location permission", "lockStep.locationPermission"],
  ["location on", "lockStep.locationOn"],
  ["restriction no_config_location", "lockStep.locationSettings"],
  ["home screen", "lockStep.home"],
  ["phone settings left to the user", "lockStep.freeSettings"],
  ["hide apps outside the allowlist", "lockStep.hideApps"],
  ["hide apps outside the allowlist (school time or bedtime)", "lockStep.hideScheduledApps"],
  ["time limits", "lockStep.time"],
  ["Chrome managed config (no DoH, no incognito, SafeSearch)", "lockStep.chrome"],
  ["factory reset protection", "lockStep.resetProtection"],
  ["private DNS", "lockStep.filter"],
  ["light mode switched off with the PIN", "lockStep.lightOff"],
  ["block apps outside the allowlist", "lockStep.blockApps"],
  ["block apps outside the allowlist (school time or bedtime)", "lockStep.blockScheduledApps"],
  ["DNS filter (VPN)", "lockStep.lightFilter"],
  ["device admin (uninstall needs it switched off first)", "lockStep.admin"],
  ["accessibility service (closes blocked apps)", "lockStep.accessibility"],
  ["private DNS not pointing elsewhere", "lockStep.lightDns"],
  ["usage access (time limits)", "lockStep.usageAccess"],
]);

export function lockStepLabel(step: string, t: T, locale: Locale): string {
  const name = step.replace(/^(factory reset protection) \(\d+ account\(s\)\)$/, "$1");
  const key = stepKeys.get(name);
  if (key) return t(key);

  const setting = SETTING_SPECS.find(({ key }) => step === `setting ${key}`);
  if (!setting) return failedPolicyLabel(name, locale) ?? t("phone.lockUnknown");

  const label = settingName(setting.key, t);
  if (setting.key === "bluetooth" || setting.key === "wifi" || setting.key === "nfc") return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}
