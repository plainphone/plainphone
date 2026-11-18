// SPDX-License-Identifier: Apache-2.0
//
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams, useParams } from "react-router";
import { errorMessage, Field, LiveStatus, LoadGate, PageTitle, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { encode } from "uqr";
import { lightSetupLink } from "../lib/light-setup";
import { api, ApiError, type Phone, type Profile } from "../lib/api";
import {
  countryCodeForTimezone,
  hashPin,
  isValidPin,
  newSalt,
  type ProvisioningInfo,
  type SetupWifi,
  provisioningPayload,
  provisioningQr,
} from "../lib/provisioning";
import "./add-phone.css";

interface EnrollmentOut {
  phone?: Phone;
  enrollment: { token: string; expiresAt: string };
  provisioning: ProvisioningInfo;
}

type Mode = Phone["mode"];

interface Qr {
  phoneId: string;
  name: string;
  mode: Mode;
  makeModules: (wifi?: SetupWifi) => boolean[][];
  link?: string;
  expiresAt: string;
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
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<Profile>(template ? "self" : "child");
  const [qr, setQr] = useState<Qr | null>(null);

  async function makeQr(pin?: string) {
    if (!mode) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Hash first: if it fails, no phone entry is left behind.
    const pinned = pin === undefined ? undefined : await hashForQr(pin);
    const out = await api.post<EnrollmentOut>("/phones/enroll", { name: name.trim(), profile, timezone, mode, ...(template ? { template } : {}) });
    if (template) {
      navigate(`/phones/${out.phone!.id}`, { replace: true });
      return;
    }
    setQr(buildQr(out, out.phone!, pinned, locale));
    setStep(3);
  }

  return (
    <div className={step === 3 ? "setup" : "narrow"}>
      <p className="back">
        <Link to="/">{t("nav.phones")}</Link>
      </p>
      {template && <p className="notice notice-info">{t("template.importHelp")}</p>}
      {!mode && <ModeStep onChoose={setMode} />}
      {mode && step !== 3 && <Progress step={step} total={mode === "light" || template ? 2 : 3} />}
      {mode && step === 1 && (
        <WhoStep
          name={name}
          profile={profile}
          onName={setName}
          onProfile={setProfile}
          selfOnly={Boolean(template)}
          onNext={mode === "light" || template ? () => makeQr() : () => setStep(2)}
          makeLink={mode === "light"}
          onBack={() => setMode(null)}
        />
      )}
      {step === 2 && <PinStep onBack={() => setStep(1)} onDone={makeQr} />}
      {step === 3 && qr && <QrStep qr={qr} />}
    </div>
  );
}

/** /phones/:pid/setup: a new QR code for a phone that has not been set up yet. */
export function SetupPhonePage() {
  const { t, locale } = useI18n();
  const { pid = "" } = useParams();
  const res = useLoad(() => api.get<Phone>(`/phones/${pid}`), [pid]);
  const [qr, setQr] = useState<Qr | null>(null);

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
          ) : qr ? (
            <QrStep qr={qr} />
          ) : (
            <PinStep
              light={phone.mode === "light"}
              onDone={async (pin) => {
                const pinned = pin === undefined ? undefined : await hashForQr(pin);
                const out = await api.post<EnrollmentOut>(`/phones/${phone.id}/enrollment`);
                setQr(buildQr(out, phone, pinned, locale));
              }}
            />
          )
        }
      </LoadGate>
    </div>
  );
}

/** Thrown when the browser cannot hash the PIN (no Web Crypto, e.g. a dashboard served over plain http). */
export class NoCryptoError extends Error {}

async function hashForQr(pin: string): Promise<{ pinHash: string; pinSalt: string }> {
  if (!globalThis.crypto?.subtle) throw new NoCryptoError("no Web Crypto");
  const pinSalt = newSalt();
  return { pinHash: await hashPin(pin, pinSalt), pinSalt };
}

function buildQr(
  out: EnrollmentOut,
  phone: Phone,
  pinned: { pinHash: string; pinSalt: string } | undefined,
  locale: string,
): Qr {
  const enrollmentToken = out.enrollment.token;
  const link = phone.mode === "light"
    ? lightSetupLink(out.provisioning.serverUrl, enrollmentToken, out.provisioning.adminComponent, locale)
    : undefined;
  return {
    phoneId: phone.id,
    name: phone.name,
    mode: phone.mode,
    link,
    expiresAt: out.enrollment.expiresAt,
    makeModules: (wifi) => link
      ? encode(link, { ecc: "L", border: 0 }).data
      : provisioningQr(provisioningPayload(out.provisioning, {
        enrollmentToken,
        ...pinned!,
        countryCode: countryCodeForTimezone(phone.timezone),
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
      <p className="muted small"><Link to="/pair">{t("add.useCode")}</Link></p>
    </>
  );
}

function Progress({ step, total = 3 }: { step: 1 | 2 | 3; total?: number }) {
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

function PinStep({ light = false, onBack, onDone }: { light?: boolean; onBack?: () => void; onDone: (pin?: string) => Promise<void> }) {
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

function QrStep({ qr }: { qr: Qr }) {
  const { t, locale } = useI18n();
  const [paired, setPaired] = useState(false);
  const light = qr.mode === "light";
  const [wifi, setWifi] = useState<SetupWifi>();
  const modules = useMemo(() => qr.makeModules(wifi), [qr, wifi]);
  const [copyStatus, setCopyStatus] = useState<"copied" | "copyFailed">();

  // Wait for the phone: it pairs itself with the token as soon as setup is done.
  const [gone, setGone] = useState<"expired" | "removed" | null>(null);
  useEffect(() => {
    if (paired || gone) return;
    let stop = false;
    const expiresAt = Date.parse(qr.expiresAt);
    const expiryTimer = window.setTimeout(() => setGone("expired"), Math.max(0, expiresAt - Date.now()));
    const id = window.setInterval(async () => {
      // Only while someone looks at the page; stop for good once the code has run out.
      if (document.hidden) return;
      try {
        const p = await api.get<Phone>(`/phones/${qr.phoneId}`);
        if (stop) return;
        if (p.pairedAt) setPaired(true);
      } catch (err) {
        if (!stop && err instanceof ApiError && err.status === 404) setGone("removed");
        // Anything else is a network hiccup: try again on the next tick.
      }
    }, 4_000);
    return () => {
      stop = true;
      window.clearInterval(id);
      window.clearTimeout(expiryTimer);
    };
  }, [qr.phoneId, qr.expiresAt, paired, gone]);

  const expires = new Intl.DateTimeFormat(locale === "da" ? "da-DK" : "en-GB", {
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
      <Progress step={light ? 2 : 3} total={light ? 2 : 3} />
      <PageTitle sub={t(light ? "add.lightQrIntro" : "add.qrIntro")}>{t("add.qrTitle", { name: qr.name })}</PageTitle>
      <div className="setup-grid">
        {!gone && <QrImage modules={modules} label={t("add.qrAlt")} />}
        <div className="setup-side">
          {!gone && (
            <>
              <ol className="setup-steps">
                <li>{t(light ? "add.light1" : "add.s1")}</li>
                <li>{t(light ? "add.light2" : "add.s2")}</li>
                <li>{t(light ? "add.light3" : "add.s3")}</li>
              </ol>
              {qr.link ? (
                <div className="actions">
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
            <p className="notice notice-error" role="alert">
              {t(gone === "expired" ? "add.expired" : "add.removed")}{" "}
              {gone === "expired" && <Link to={`/phones/${qr.phoneId}/setup`} reloadDocument>{t(light ? "add.newLink" : "setup.showQr")}</Link>}
            </p>
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
