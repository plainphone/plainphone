// SPDX-License-Identifier: Apache-2.0
import type { MessageKey } from "../i18n/translate";
import type { Locale } from "./api";

const labels = new Map<string, Record<"en" | "da", string>>();
function add(step: string, en: string, da: string) {
  labels.set(step, { en, da });
}

export const BATTERY_EXEMPTION_POLICY = "battery exemption missing: self-update cannot run";

export function updateBatteryExemptionMessage(
  status: { failedPolicies: readonly string[]; update?: { errorCode?: string } },
): MessageKey | undefined {
  if (status.failedPolicies.includes(BATTERY_EXEMPTION_POLICY)) return "phone.updateBatteryExemptionMissing";
  if (status.update?.errorCode === "battery_exemption_missing") return "phone.updateBatteryExemptionLegacy";
}

add(BATTERY_EXEMPTION_POLICY, "allow Plainphone to run in the background for updates", "tillad Plainphone at køre i baggrunden for at opdatere");
add("remote release", "switch Plainphone off", "slå Plainphone fra");
add("bootloader warning", "confirm the system warning on the phone", "bekræft advarslen om telefonens system");
add("device owner", "give Plainphone control of the phone", "giv Plainphone kontrol over telefonen");
add("default phone app", "make Plainphone the phone app", "brug Plainphone til opkald");
add("default SMS app", "make Plainphone the messaging app", "brug Plainphone til sms");
add("phone and SMS permissions", "allow calls and texts", "tillad opkald og sms");
add("block uninstall of Plainphone", "prevent Plainphone from being removed", "beskyt Plainphone mod at blive fjernet");
add("automatic date and time", "set the date and time automatically", "indstil dato og tid automatisk");
add("Chrome managed config (no DoH, no incognito, SafeSearch)", "apply Chrome safety settings", "anvend sikkerhedsindstillinger i Chrome");
add("private DNS", "turn on the web filter", "slå webfilteret til");
add("private DNS not pointing elsewhere", "use Plainphone’s web filter", "brug Plainphones webfilter");
add("DNS filter (VPN)", "turn on the web filter", "slå webfilteret til");
add("hide apps outside the allowlist", "hide unapproved apps", "skjul apps, der ikke er godkendt");
add("hide apps outside the allowlist (school time or bedtime)", "hide apps during school time or bedtime", "skjul apps i skoletiden eller ved sengetid");
add("block apps outside the allowlist", "block unapproved apps", "blokér apps, der ikke er godkendt");
add("factory reset protection", "protect the phone after a reset", "beskyt telefonen efter en nulstilling");
add("accounts on the phone", "check accounts on the phone", "tjek konti på telefonen");
add("no force stop of Plainphone", "prevent Plainphone from being stopped", "beskyt Plainphone mod at blive stoppet");
add("extra users and profiles", "remove extra users or profiles", "fjern ekstra brugere eller profiler");
add("enable call role services", "turn on call filtering", "slå opkaldsfilteret til");
add("no lock screen widgets", "hide widgets on the lock screen", "skjul widgets på låseskærmen");
add("only built-in keyboards", "limit keyboards to built-in options", "tillad kun indbyggede tastaturer");
add("only built-in accessibility services", "limit accessibility services to built-in options", "tillad kun indbyggede hjælpefunktioner");
add("call screening role", "allow Plainphone to filter incoming calls", "giv Plainphone lov til at filtrere indgående opkald");
add("call redirection role", "allow Plainphone to filter outgoing calls", "giv Plainphone lov til at filtrere udgående opkald");
add("contacts permission for call screening", "allow contact access for call filtering", "tillad adgang til kontakter til opkaldsfilteret");
add("home screen", "set the home screen", "indstil startskærmen");
add("phone settings left to the user", "leave selected settings available", "hold de valgte indstillinger åbne");
add("location setting free", "let the phone user manage location", "lad telefonens bruger styre placering");
add("location permission", "allow location access", "tillad adgang til placering");
add("location on", "turn on location", "slå placering til");
add("time limits", "apply time limits", "anvend tidsgrænser");
add("usage access (time limits)", "allow app usage access for time limits", "giv adgang til appbrug for at håndhæve tidsgrænser");
add("light mode switched off with the PIN", "turn light mode back on", "slå let tilstand til igen");
add("device admin (uninstall needs it switched off first)", "protect Plainphone from removal", "beskyt Plainphone mod at blive fjernet");
add("accessibility service (closes blocked apps)", "allow Plainphone to close blocked apps", "giv Plainphone lov til at lukke blokerede apps");
add("install window: clear no_install_apps", "allow the approved app to be installed", "tillad installation af den godkendte app");

add("hardware attestation: unlocked", "check the phone’s startup lock", "tjek låsen, der beskytter telefonens system");
add("hardware attestation: custom-os", "restore the manufacturer’s system", "gendan producentens system");
add("hardware attestation: failed-boot", "check why the phone’s system did not pass its security check", "tjek, hvorfor telefonens system ikke bestod sikkerhedstjekket");
add("hardware attestation", "check the phone’s system", "tjek telefonens system");

const restrictions: Record<string, [string, string]> = {
  no_config_locale: ["Lock Android language", "Lås sproget i Android"],
  no_install_apps: ["block app installation", "blokér installation af apps"],
  no_install_unknown_sources: ["block apps from unknown sources", "blokér apps fra ukendte kilder"],
  no_install_unknown_sources_globally: ["block apps from unknown sources for all users", "blokér apps fra ukendte kilder for alle brugere"],
  no_factory_reset: ["block reset in Settings", "blokér nulstilling i Indstillinger"],
  no_safe_boot: ["block safe mode", "blokér fejlsikret tilstand"],
  no_add_user: ["block new users", "blokér nye brugere"],
  no_user_switch: ["block switching users", "blokér skift mellem brugere"],
  no_add_managed_profile: ["block work profiles", "blokér arbejdsprofiler"],
  no_add_clone_profile: ["block app cloning", "blokér kopiering af apps"],
  no_add_private_profile: ["block private spaces", "blokér private områder"],
  no_debugging_features: ["block developer options", "blokér udviklerindstillinger"],
  disallow_config_private_dns: ["protect web filter settings", "beskyt webfilterets indstillinger"],
  no_config_vpn: ["block VPN changes", "blokér ændringer af VPN"],
  no_network_reset: ["block network reset", "blokér nulstilling af netværket"],
  no_config_credentials: ["block changes to trusted certificates", "blokér ændringer af betroede certifikater"],
  no_usb_file_transfer: ["block file transfers over USB", "blokér filoverførsel via USB"],
  no_physical_media: ["block external storage", "blokér eksterne lagermedier"],
  no_config_date_time: ["block date and time changes", "blokér ændringer af dato og tid"],
  disallow_config_default_apps: ["block changes to default apps", "blokér ændringer af standardapps"],
  no_modify_accounts: ["block account changes", "blokér ændringer af konti"],
  no_content_capture: ["block app content capture", "blokér indsamling af appindhold"],
  no_content_suggestions: ["block suggestions based on app content", "blokér forslag baseret på appindhold"],
  no_assist_content: ["block sharing screen content with assistants", "blokér deling af skærmindhold med assistenter"],
  no_config_location: ["block location setting changes", "blokér ændringer af placeringsindstillinger"],
};
for (const [key, [en, da]] of Object.entries(restrictions)) add(`restriction ${key}`, en, da);

export function failedPolicyLabel(step: string, locale: Locale): string | undefined {
  const key = step.startsWith("extra users and profiles:") ? "extra users and profiles" : step;
  return labels.get(key)?.[locale === "da" ? "da" : "en"] ??
    (key.startsWith("hardware attestation:") ? labels.get("hardware attestation")?.[locale === "da" ? "da" : "en"] : undefined);
}

/** Export known policy names only. Reports can contain free text from older phones. */
export function diagnosticPolicy(step: string): string {
  if (labels.has(step)) return step;
  if (step.startsWith("extra users and profiles:")) return "extra users and profiles";
  if (step.startsWith("install window overran:")) return "install window overran";
  return "other";
}
