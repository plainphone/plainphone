// SPDX-License-Identifier: Apache-2.0
//
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams, useParams } from "react-router";
import { Switch, errorMessage, Field, LiveStatus, LoadGate, PageTitle, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { encode } from "uqr";
import { intlLocale } from "../lib/format";
import { lightSetupLink } from "../lib/light-setup";
import { api, ApiError, applyAgePreset, getAgePresets, type Phone, type Profile, putAgreement, putReview } from "../lib/api";
import { type AgePresetId, parseLines } from "../lib/age";
import { AgePicker, AgreementFields, type AgreementDraft, agreementProblems, ReviewPicker } from "../components/AgeControls";
import {
  hashPin,
  isValidPin,
  newSalt,
  type ProvisioningInfo,
  type SetupWifi,
  provisioningPayload,
  provisioningQr,
} from "../lib/provisioning";
import { PhoneLanguagePicker } from "../components/PhoneLanguagePicker";
import type { PhoneLanguage } from "../lib/phone-language";
import "./add-phone.css";

interface EnrollmentOut {
  phone?: Phone;
  enrollment: { id: string; token: string; expiresAt: string };
  provisioning: ProvisioningInfo & {
    mode: Phone["mode"];
    profile: Profile;
    timezone: string;
    locale: string | null;
    countryCode: string | null;
  };
}

type Mode = Phone["mode"];

interface Qr {
  enrollmentId: string;
  phoneId: string;
  name: string;
  mode: Mode;
  makeModules: (wifi?: SetupWifi) => boolean[][];
  link?: string;
  expiresAt: string;
  /** A fresh code for the same phone (and the same PIN), so an expired code never costs the parent their place. */
  restart: () => Promise<Qr>;
}

/** /add: a new phone. */
export function AddPhonePage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [template] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("template"));
  useEffect(() => {
    if (template) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [template]);
  const [params] = useSearchParams();
  const choice = params.get("mode");
  const [mode, setMode] = useState<Mode | null>(choice === "light" || choice === "strong" ? choice : null);
  const [step, setStep] = useState<SetupStep>("who");
  const [age, setAge] = useState<AgeChoices>({ preset: null, review: true, months: 3 });
  const [agreement, setAgreement] = useState<AgreementDraft>({ lines: "", adultLines: "" });
  const [setupNote, setSetupNote] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState<PhoneLanguage>(null);
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [privateDns, setPrivateDns] = useState(false);
  const [profile, setProfile] = useState<Profile>(template ? "self" : "child");
  const [qr, setQr] = useState<Qr | null>(null);

  // A Child phone has two optional steps before the code: where the rules start (docs/age-presets.md)
  // and the family agreement (docs/family-agreement.md). Light mode has no PIN step.
  const flow = setupFlow(mode, profile, Boolean(template));
  const at = flow.indexOf(step);
  const previous = flow[at - 1];

  async function makeQr(pin?: string, skipAgreement = false) {
    if (!mode) return;
    // Hash first: if it fails, no phone entry is left behind.
    const pinned = pin === undefined ? undefined : await hashForQr(pin);
    const out = await api.post<EnrollmentOut>("/phones/enroll", { name: name.trim(), profile, timezone, mode, language, ...(mode === "light" && profile === "self" && privateDns ? { filterMethod: "privateDns" } : {}), ...(template ? { template } : {}) });
    if (template) {
      navigate(`/phones/${out.phone!.id}`, { replace: true });
      return;
    }
    // The phone exists now: what was chosen on the way is saved on it. A failure here never loses the code.
    if (profile === "child") {
      const failed = await saveAgeChoices(out.phone!.id, age, skipAgreement ? { lines: "", adultLines: "" } : agreement);
      setSetupNote(failed ? t("age.setupSaveFailed") : null);
    }
    setQr(buildQr(out, out.phone!, pinned, locale));
    setStep("qr");
  }

  /** The next step, or the code itself after the last one. */
  async function advance(pin?: string, skipAgreement = false) {
    const next = flow[at + 1];
    if (!next || next === "qr") await makeQr(pin, skipAgreement);
    else setStep(next);
  }

  return (
    <div className={step === "qr" ? "setup" : "narrow"}>
      <p className="back">
        <Link to="/">{t("nav.phones")}</Link>
      </p>
      {template && <p className="notice notice-info">{t("template.importHelp")}</p>}
      {!mode && <ModeStep onChoose={setMode} />}
      {mode && step !== "qr" && <Progress step={at + 1} total={flow.length - 1} />}
      {mode && step === "who" && (
        <WhoStep
          name={name}
          profile={profile}
          onName={setName}
          onProfile={setProfile}
          selfOnly={Boolean(template)}
          onNext={() => advance()}
          makeLink={mode === "light" && flow.length === 2}
          privateDns={privateDns}
          onPrivateDns={setPrivateDns}
          onBack={() => setMode(null)}
        />
      )}
      {step === "age" && (
        <AgeStep name={name.trim()} choices={age} onChange={setAge} onBack={() => setStep(previous!)}
          onNext={() => void advance()} />
      )}
      {step === "agreement" && (
        <AgreementStep draft={agreement} onChange={setAgreement} light={mode === "light"} onBack={() => setStep(previous!)}
          onNext={(skip) => advance(undefined, skip)} />
      )}
      {step === "pin" && (
        <PinStep onBack={() => setStep(previous!)} onDone={(pin) => advance(pin)}>
          <PhoneLanguagePicker value={language} onChange={setLanguage} setup={profile === "child"} />
          <SetupTimezonePicker value={timezone} onChange={setTimezone} />
        </PinStep>
      )}
      {step === "qr" && qr && (
        <>
          {setupNote && <p className="notice notice-warn" role="status">{setupNote}</p>}
          <QrStep key={qr.enrollmentId} qr={qr} progress={{ step: flow.length, total: flow.length }} />
        </>
      )}
    </div>
  );
}

type SetupStep = "who" | "age" | "agreement" | "pin" | "qr";

/** The steps of a new phone, in order. Light mode has no PIN; a Self phone and a template have no age or agreement. */
function setupFlow(mode: Mode | null, profile: Profile, template: boolean): SetupStep[] {
  const child = profile === "child" && !template;
  return [
    "who",
    ...(child ? ["age", "agreement"] as const : []),
    ...(mode === "strong" && !template ? ["pin"] as const : []),
    "qr",
  ];
}

interface AgeChoices {
  preset: AgePresetId | null;
  review: boolean;
  months: number;
}

/** Saves the setup choices on the new phone. True when something could not be saved. */
async function saveAgeChoices(phoneId: string, age: AgeChoices, agreement: AgreementDraft): Promise<boolean> {
  let failed = false;
  const attempt = async (call: () => Promise<unknown>) => {
    try {
      await call();
    } catch {
      failed = true;
    }
  };
  if (age.preset) await attempt(() => applyAgePreset(phoneId, age.preset!));
  if (age.review) await attempt(() => putReview(phoneId, { enabled: true, intervalMonths: age.months }));
  const lines = parseLines(agreement.lines);
  const adultLines = parseLines(agreement.adultLines);
  if (lines.length > 0 || adultLines.length > 0) await attempt(() => putAgreement(phoneId, { lines, adultLines }));
  return failed;
}

/** Where the rules start, and when to look at them again. Both can be skipped or changed later. */
function AgeStep({ name, choices, onChange, onBack, onNext }: {
  name: string;
  choices: AgeChoices;
  onChange: (choices: AgeChoices) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { t } = useI18n();
  const presets = useLoad(getAgePresets, []);
  return (
    <>
      <PageTitle sub={t("age.setupIntro")}>{t("age.setupTitle", { name })}</PageTitle>
      <div className="stack">
        <LoadGate res={presets}>
          {(list) => <AgePicker presets={list} value={choices.preset} onChange={(preset) => onChange({ ...choices, preset })} name="age" />}
        </LoadGate>
        <ReviewPicker enabled={choices.review} months={choices.months}
          onEnabled={(review) => onChange({ ...choices, review })} onMonths={(months) => onChange({ ...choices, months })} />
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={onNext}>{t("age.continue")}</button>
          <button type="button" className="btn-link" onClick={onBack}>{t("app.back")}</button>
        </div>
      </div>
    </>
  );
}

/** An optional few lines the family agrees on, in the child's words. */
function AgreementStep({ draft, onChange, light, onBack, onNext }: {
  draft: AgreementDraft;
  onChange: (draft: AgreementDraft) => void;
  light: boolean;
  onBack: () => void;
  onNext: (skip: boolean) => Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problems = agreementProblems(draft);
  const empty = parseLines(draft.lines).length === 0 && parseLines(draft.adultLines).length === 0;
  async function go(skip: boolean) {
    if (skip) onChange({ lines: "", adultLines: "" });
    setBusy(true);
    setError(null);
    try {
      await onNext(skip);
    } catch (err) {
      setError(errorMessage(err, t));
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle sub={t("age.agreement.intro")}>{t("age.agreement.title")}</PageTitle>
      <div className="stack">
        <p className="help">{t("age.agreement.optional")}</p>
        <AgreementFields draft={draft} onChange={onChange} disabled={busy} />
        <LiveStatus notice={error ? { tone: "error", text: error } : null} />
        <div className="actions">
          <button type="button" className="btn btn-primary" disabled={busy || problems.lines !== null || problems.adultLines !== null}
            onClick={() => void go(empty)}>
            {t(busy ? "add.making" : light ? "add.makeLink" : empty ? "age.skip" : "age.continue")}
          </button>
          {!empty && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void go(true)}>{t("age.skip")}</button>}
          <button type="button" className="btn-link" onClick={onBack} disabled={busy}>{t("app.back")}</button>
        </div>
      </div>
    </>
  );
}

/** /phones/:pid/setup: a new QR code for a phone that has not been set up yet. */
export function SetupPhonePage() {
  const { t, locale } = useI18n();
  const { pid = "" } = useParams();
  const res = useLoad(() => api.get<Phone>(`/phones/${pid}`), [pid]);
  const [qr, setQr] = useState<Qr | null>(null);
  const [chosenLanguage, setChosenLanguage] = useState<PhoneLanguage>();
  const [chosenTimezone, setChosenTimezone] = useState<string>();

  return (
    <div className={qr ? "setup" : "narrow"}>
      <p className="back">
        <Link to={`/phones/${pid}`}>{t("app.back")}</Link>
      </p>
      <LoadGate res={res}>
        {(phone) =>
          phone.pairedAt ? (
            <>
              <PageTitle sub={t("setup.alreadyBody")}>{t("setup.alreadyTitle")}</PageTitle>
              <Link className="btn btn-primary" to={`/phones/${phone.id}`}>
                {t("setup.open", { name: phone.name })}
              </Link>
            </>
          ) : phone.setupQrAvailable === false ? (
            <PageTitle sub={t("setup.codePendingBody")}>{t("setup.pendingTitle")}</PageTitle>
          ) : qr ? (
            <QrStep key={qr.enrollmentId} qr={qr} />
          ) : (
            <PinStep
              light={phone.mode === "light"}
              onDone={async (pin) => {
                const pinned = pin === undefined ? undefined : await hashForQr(pin);
                const updated = chosenLanguage !== undefined || chosenTimezone !== undefined
                  ? await api.patch<Phone>(`/phones/${phone.id}`, { language: chosenLanguage, timezone: chosenTimezone })
                  : phone;
                res.setData(() => updated);
                const out = await api.post<EnrollmentOut>(`/phones/${phone.id}/enrollment`);
                setQr(buildQr(out, updated, pinned, locale));
              }}
            >
              {phone.mode === "strong" && (
                <>
                  <PhoneLanguagePicker value={chosenLanguage === undefined ? phone.language ?? null : chosenLanguage} onChange={setChosenLanguage} setup={phone.profile === "child"} />
                  <SetupTimezonePicker value={chosenTimezone ?? phone.timezone} onChange={setChosenTimezone} />
                </>
              )}
            </PinStep>
          )
        }
      </LoadGate>
    </div>
  );
}

function SetupTimezonePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const zones = useMemo(
    () => [...new Set(["UTC", ...Intl.supportedValuesOf("timeZone"), value])].sort(),
    [value],
  );
  return (
    <Field label={t("add.timezone")} help={t("add.timezoneHelp")}>
      {(props) => (
        <select {...props} value={value} onChange={(event) => onChange(event.target.value)}>
          {zones.map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
        </select>
      )}
    </Field>
  );
}

/** Thrown when the browser cannot hash the PIN (no Web Crypto, e.g. a dashboard served over plain http). */
export class NoCryptoError extends Error {}

async function hashForQr(pin: string): Promise<{ pinHash: string; pinSalt: string }> {
  if (!globalThis.crypto?.subtle) throw new NoCryptoError("no Web Crypto");
  const pinSalt = newSalt();
  return { pinHash: await hashPin(pin, pinSalt), pinSalt };
}

export function buildQr(
  out: EnrollmentOut,
  phone: Pick<Phone, "id" | "name" | "mode" | "timezone">,
  pinned: { pinHash: string; pinSalt: string } | undefined,
  locale: string,
): Qr {
  const enrollmentToken = out.enrollment.token;
  const { mode, profile, timezone, locale: setupLocale, countryCode } = out.provisioning;
  const link = mode === "light"
    ? lightSetupLink(out.provisioning.serverUrl, enrollmentToken, out.provisioning.adminComponent, locale)
    : undefined;
  return {
    enrollmentId: out.enrollment.id,
    phoneId: phone.id,
    name: phone.name,
    mode,
    link,
    expiresAt: out.enrollment.expiresAt,
    restart: async () => buildQr(await api.post<EnrollmentOut>(`/phones/${phone.id}/enrollment`), phone, pinned, locale),
    makeModules: (wifi) => link
      ? encode(link, { ecc: "L", border: 0 }).data
      : provisioningQr(provisioningPayload(out.provisioning, {
        enrollmentToken,
        ...pinned!,
        countryCode,
        locale: setupLocale,
        profile,
        timezone,
        wifi,
      })).modules,
  };
}

function ModeStep({ onChoose }: { onChoose: (mode: Mode) => void }) {
  const { t } = useI18n();
  return (
    <>
      <PageTitle>{t("add.modeTitle")}</PageTitle>
      <div className="setup-options">
        <button type="button" className="choice" onClick={() => onChoose("strong")}>
          <span className="choice-title">{t("add.modeStrong")}</span>
          <span className="choice-desc">{t("add.modeStrongHelp")}</span>
        </button>
        <button type="button" className="choice" onClick={() => onChoose("light")}>
          <span className="choice-title">{t("add.modeLight")}</span>
          <span className="choice-desc">{t("add.modeLightHelp")}</span>
        </button>
      </div>
      <p><Link className="btn btn-secondary" to="/pair">{t("add.useCode")}</Link></p>
    </>
  );
}

function Progress({ step, total = 3 }: { step: number; total?: number }) {
  const { t } = useI18n();
  return (
    <div className="steps" role="img" aria-label={t("add.stepOf", { n: step, total })}>
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <span key={n} className={n <= step ? "step-on" : undefined} />
      ))}
    </div>
  );
}

function WhoStep(props: {
  name: string;
  profile: Profile;
  onName: (v: string) => void;
  onProfile: (v: Profile) => void;
  selfOnly?: boolean;
  onNext: () => void | Promise<void>;
  makeLink: boolean;
  privateDns: boolean;
  onPrivateDns: (value: boolean) => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!props.name.trim()) {
      setError(t("pair.nameRequired"));
      nameInput.current?.focus();
      return;
    }
    setFormError(null);
    setBusy(true);
    try {
      await props.onNext();
    } catch (err) {
      setFormError(errorMessage(err, t));
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle>{t("add.whoTitle")}</PageTitle>
      <form onSubmit={submit} noValidate className="stack">
        <fieldset className="choices">
          <legend className="sr-only">{t("pair.profile")}</legend>
          {(props.selfOnly ? ["self"] as const : ["child", "self"] as const).map((p) => (
            <label key={p} className="choice">
              <input type="radio" name="profile" value={p} checked={props.profile === p} onChange={() => props.onProfile(p)} />
              <span>
                <span className="choice-title">{t(p === "child" ? "profile.child" : "profile.self")}</span>
                <span className="choice-desc">{t(p === "child" ? "profile.childHelp" : "profile.selfHelp")}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {props.makeLink && props.profile === "self" && (
          <Switch label={t("filter.otherVpn")} checked={props.privateDns} onChange={props.onPrivateDns}
            description={props.privateDns ? t("filter.tailscaleTip") : t("filter.methodHelp")} />
        )}
        <Field label={t("pair.name")} help={t("pair.nameHelp")} error={error}>
          {(p) => (
            <input
              {...p}
              ref={nameInput}
              name="name"
              maxLength={40}
              autoComplete="off"
              value={props.name}
              onChange={(e) => {
                props.onName(e.target.value);
                if (error) setError(undefined);
              }}
            />
          )}
        </Field>
        <LiveStatus notice={formError ? { tone: "error", text: formError } : null} />
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t(busy ? "add.making" : props.makeLink ? "add.makeLink" : "add.next")}
          </button>
        </div>
        <button type="button" className="btn-link" onClick={props.onBack} disabled={busy}>{t("app.back")}</button>
      </form>
    </>
  );
}

function PinStep({ light = false, onBack, onDone, children }: { light?: boolean; onBack?: () => void; onDone: (pin?: string) => Promise<void>; children?: ReactNode }) {
  const { t } = useI18n();
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [errors, setErrors] = useState<{ pin?: string; again?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pinInput = useRef<HTMLInputElement>(null);
  const againInput = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const next: typeof errors = {};
    if (!light && !isValidPin(pin)) next.pin = t("add.pinInvalid");
    else if (!light && pin !== again) next.again = t("add.pinMismatch");
    setErrors(next);
    if (next.pin) return pinInput.current?.focus();
    if (next.again) return againInput.current?.focus();
    setBusy(true);
    try {
      await onDone(light ? undefined : pin);
    } catch (err) {
      setFormError(err instanceof NoCryptoError ? t("add.noCrypto") : errorMessage(err, t));
      setBusy(false);
    }
  }

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 12);
  return (
    <>
      <PageTitle sub={t(light ? "add.lightPinOnPhone" : "add.pinIntro")}>{t(light ? "add.newLink" : "add.pinTitle")}</PageTitle>
      <form onSubmit={submit} noValidate className="stack">
        {children && <fieldset disabled={busy} className="choices">{children}</fieldset>}
        {!light && (
          <>
            <Field label={t("add.pin")} help={t("add.pinHelp")} error={errors.pin}>
              {(p) => (
                <input
                  {...p}
                  ref={pinInput}
                  className="input-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  name="pin"
                  value={pin}
                  onChange={(e) => setPin(digits(e.target.value))}
                />
              )}
            </Field>
            <Field label={t("add.pinAgain")} error={errors.again}>
              {(p) => (
                <input
                  {...p}
                  ref={againInput}
                  className="input-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  name="pin-again"
                  value={again}
                  onChange={(e) => setAgain(digits(e.target.value))}
                />
              )}
            </Field>
          </>
        )}
        <LiveStatus notice={formError ? { tone: "error", text: formError } : null} />
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t(busy ? "add.making" : light ? "add.makeLink" : "add.makeQr")}
          </button>
          {onBack && (
            <button type="button" className="btn-link" onClick={onBack} disabled={busy}>
              {t("app.back")}
            </button>
          )}
        </div>
      </form>
    </>
  );
}

function QrStep({ qr: first, progress }: { qr: Qr; progress?: { step: number; total: number } }) {
  const { t, locale } = useI18n();
  const [qr, setQr] = useState(first);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [restartPending, setRestartPending] = useState(false);
  const restartRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLParagraphElement>(null);
  const [paired, setPaired] = useState(false);
  const light = qr.mode === "light";
  const [wifi, setWifi] = useState<SetupWifi>();
  const modules = useMemo(() => qr.makeModules(wifi), [qr, wifi]);
  const [copyStatus, setCopyStatus] = useState<"copied" | "copyFailed">();

  // Wait for the phone: it pairs itself with the token as soon as setup is done.
  const [gone, setGone] = useState<"expired" | "outdated" | "removed" | null>(null);
  useEffect(() => {
    if (paired || gone) return;
    let stop = false;
    const expiresAt = Date.parse(qr.expiresAt);
    const expiryTimer = window.setTimeout(() => setGone("expired"), Math.max(0, expiresAt - Date.now()));
    let checking = false;
    async function check() {
      // Only while someone looks at the page; stop for good once the code has run out.
      if (document.hidden || checking) return;
      checking = true;
      try {
        const p = await api.get<Phone>(`/phones/${qr.phoneId}`);
        if (stop) return;
        if (p.pairedAt) setPaired(true);
        else if (p.setupEnrollmentId !== qr.enrollmentId) setGone("outdated");
      } catch (err) {
        if (!stop && err instanceof ApiError && err.status === 404) setGone("removed");
        // Anything else is a network hiccup: try again on the next tick.
      } finally {
        checking = false;
      }
    }
    void check();
    const id = window.setInterval(check, 4_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      stop = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", check);
      window.clearTimeout(expiryTimer);
    };
  }, [qr.phoneId, qr.enrollmentId, qr.expiresAt, paired, gone]);

  // The focused element disappears with the code: move focus to the way forward.
  useEffect(() => {
    if (gone === "expired") restartRef.current?.focus();
  }, [gone]);

  async function restart() {
    setRestarting(true);
    setRestartError(null);
    try {
      setQr(await qr.restart());
      setGone(null);
      // Keep keyboard and screen-reader users at the first instruction of the new code.
      window.setTimeout(() => startRef.current?.focus(), 0);
    } catch (err) {
      // 409: the phone paired (or waits for confirmation) in the meantime. Ask the server
      // instead of showing a dead end.
      if (err instanceof ApiError && err.status === 409) {
        try {
          const p = await api.get<Phone>(`/phones/${qr.phoneId}`);
          if (p.pairedAt) {
            setPaired(true);
            return;
          }
        } catch { /* fall through to the setup page link */ }
        setRestartPending(true);
      } else {
        setRestartError(errorMessage(err, t));
      }
    } finally {
      setRestarting(false);
    }
  }

  const expires = new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(qr.expiresAt));

  if (paired) {
    return (
      <div className="setup-done">
        <PageTitle sub={t("add.pairedTitle", { name: qr.name })}>{t("add.getStarted")}</PageTitle>
        <ul className="setup-options setup-links">
          <li><Link className="choice" to={`/phones/${qr.phoneId}/contacts`}>{t("add.firstContacts")}</Link></li>
          <li><Link className="choice" to={`/phones/${qr.phoneId}/apps/add`}>{t("add.firstApps")}</Link></li>
          <li><Link className="choice" to={`/phones/${qr.phoneId}/schedules`}>{t("add.firstSchedule")}</Link></li>
        </ul>
        <Link className="btn btn-primary" to={`/phones/${qr.phoneId}`}>{t("setup.open", { name: qr.name })}</Link>
      </div>
    );
  }

  return (
    <>
      <Progress step={progress?.step ?? (light ? 2 : 3)} total={progress?.total ?? (light ? 2 : 3)} />
      <PageTitle sub={t(light ? "add.lightQrIntro" : "add.qrIntro")}>{t("add.qrTitle", { name: qr.name })}</PageTitle>
      {!gone && (
        <p className="setup-first" ref={startRef} tabIndex={-1}>
          <span className="setup-first-label">{t("add.startHere")}</span>
          {t(light ? "add.light1" : "add.s1")}
        </p>
      )}
      <div className="setup-grid">
        {!gone && <QrImage modules={modules} label={t("add.qrAlt")} />}
        <div className="setup-side">
          {!gone && (
            <>
              <ol className="setup-steps setup-steps-after" start={2}>
                <li>{t(light ? "add.light2" : "add.s2")}</li>
                <li>{t(light ? "add.light3" : "add.s3")}</li>
              </ol>
              {qr.link ? (
                <div className="actions">
                  <span className="setup-fallback">{t("add.cantScan")}</span>
                  <a href={qr.link} target="_blank" rel="noreferrer">{t("add.setupLink")}</a>
                  {navigator.clipboard && (
                    <button type="button" className="btn btn-secondary" onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(qr.link!);
                        setCopyStatus("copied");
                      } catch {
                        setCopyStatus("copyFailed");
                      }
                    }}>{t("add.copyLink")}</button>
                  )}
                  {copyStatus && <span role="status">{t(`add.${copyStatus}`)}</span>}
                </div>
              ) : <WifiForm wifi={wifi} onChange={setWifi} />}
            </>
          )}
          {gone ? (
            <div className="notice notice-error setup-gone">
              <p role="alert">{t(({ expired: "add.expired", outdated: "add.outdatedQr", removed: "add.removed" } as const)[gone])}</p>
              {restartError && <p>{restartError}</p>}
              {restartPending && <p><Link to={`/phones/${qr.phoneId}/setup`}>{t("setup.open", { name: qr.name })}</Link></p>}
              {gone === "expired" && !restartPending && (
                <button ref={restartRef} type="button" className="btn btn-primary" onClick={() => void restart()} disabled={restarting}>
                  {t(restarting ? "add.making" : light ? "add.newLink" : "add.newCode")}
                </button>
              )}
              {gone === "outdated" && (
                // A newer code exists elsewhere: restarting here would replace it, so open the setup page.
                <Link className="btn btn-primary" to={`/phones/${qr.phoneId}/setup`} reloadDocument>
                  {t(light ? "add.newLink" : "setup.showQr")}
                </Link>
              )}
            </div>
          ) : (
            <p className="setup-wait" role="status">
              <span className="pulse" aria-hidden="true" />
              {t("add.waiting")}
            </p>
          )}
          {!gone && <p className="muted small">{t("add.qrPrivate", { when: expires })}</p>}
          <p className="small">
            <a href={t("add.guideUrl")} target="_blank" rel="noreferrer">
              {t("add.guide")}
            </a>
          </p>
        </div>
      </div>
    </>
  );
}

function WifiForm({ wifi, onChange }: { wifi?: SetupWifi; onChange: (wifi?: SetupWifi) => void }) {
  const { t } = useI18n();
  return (
    <details className="setup-wifi">
      <summary>{t(wifi ? "add.wifiAdded" : "add.wifiTitle")}</summary>
      <form className="stack" autoComplete="off" onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const ssid = String(fields.get("ssid") ?? "");
        if (ssid.trim()) onChange({ ssid, password: String(fields.get("password") ?? "") });
      }}>
        <p className="muted small">{t("add.wifiPrivate")}</p>
        <Field label={t("add.wifiName")}>{(props) => <input {...props} name="ssid" required pattern=".*\S.*" maxLength={32} />}</Field>
        <Field label={t("add.wifiPassword")}>{(props) => <input {...props} name="password" type="password" minLength={8} maxLength={63} />}</Field>
        <div className="actions">
          <button type="submit" className="btn btn-secondary">{t("add.wifiApply")}</button>
          {wifi && <button type="reset" className="btn-link" onClick={() => onChange()}>{t("add.wifiRemove")}</button>}
        </div>
      </form>
    </details>
  );
}

/** Black on white with a quiet zone, also in dark mode, so every camera can read it. */
export function QrImage({ modules, label }: { modules: boolean[][]; label: string }) {
  const size = modules.length;
  const path = useMemo(() => {
    let d = "";
    modules.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) d += `M${x + 4} ${y + 4}h1v1h-1z`;
      }),
    );
    return d;
  }, [modules]);
  return (
    <figure className="qr">
      <svg viewBox={`0 0 ${size + 8} ${size + 8}`} role="img" aria-label={label} shapeRendering="crispEdges">
        <rect width={size + 8} height={size + 8} fill="#fff" />
        <path d={path} fill="#000" />
      </svg>
    </figure>
  );
}
