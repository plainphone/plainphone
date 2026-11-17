// SPDX-License-Identifier: Apache-2.0
//
// "Add phone": strong-mode setup without a computer. Three short steps: who the phone is for,
// a maintenance PIN, then the provisioning QR code the reset phone scans. The PIN is hashed in
// this browser and goes into the QR code only (lib/provisioning.ts).

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { errorMessage, Field, LiveStatus, LoadGate, PageTitle, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, type Phone, type Profile } from "../lib/api";
import {
  countryCodeForTimezone,
  hashPin,
  isValidPin,
  newSalt,
  type ProvisioningInfo,
  provisioningPayload,
  provisioningQr,
} from "../lib/provisioning";
import "./add-phone.css";

interface EnrollmentOut {
  phone?: Phone;
  enrollment: { token: string; expiresAt: string };
  provisioning: ProvisioningInfo;
}

interface Qr {
  phoneId: string;
  name: string;
  modules: boolean[][];
  expiresAt: string;
}

/** /add: a new phone. */
export function AddPhonePage() {
  const { t } = useI18n();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<Profile>("child");
  const [qr, setQr] = useState<Qr | null>(null);

  async function makeQr(pin: string) {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const out = await api.post<EnrollmentOut>("/phones/enroll", { name: name.trim(), profile, timezone });
    setQr(await buildQr(out, out.phone!.id, out.phone!.name, pin, timezone));
    setStep(3);
  }

  return (
    <div className={step === 3 ? "setup" : "narrow"}>
      <p className="back">
        <Link to="/">{t("nav.phones")}</Link>
      </p>
      <Progress step={step} />
      {step === 1 && (
        <WhoStep
          name={name}
          profile={profile}
          onName={setName}
          onProfile={setProfile}
          onNext={() => setStep(2)}
        />
      )}
      {step === 2 && <PinStep onBack={() => setStep(1)} onDone={makeQr} />}
      {step === 3 && qr && <QrStep qr={qr} />}
    </div>
  );
}

/** /phones/:pid/setup: a new QR code for a phone that has not been set up yet. */
export function SetupPhonePage() {
  const { t } = useI18n();
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
              onDone={async (pin) => {
                const out = await api.post<EnrollmentOut>(`/phones/${phone.id}/enrollment`);
                setQr(await buildQr(out, phone.id, phone.name, pin, phone.timezone));
              }}
            />
          )
        }
      </LoadGate>
    </div>
  );
}

async function buildQr(out: EnrollmentOut, phoneId: string, name: string, pin: string, timezone: string): Promise<Qr> {
  const pinSalt = newSalt();
  const pinHash = await hashPin(pin, pinSalt);
  const payload = provisioningPayload(out.provisioning, {
    enrollmentToken: out.enrollment.token,
    pinHash,
    pinSalt,
    countryCode: countryCodeForTimezone(timezone),
  });
  return { phoneId, name, modules: provisioningQr(payload).modules, expiresAt: out.enrollment.expiresAt };
}

function Progress({ step }: { step: 1 | 2 | 3 }) {
  const { t } = useI18n();
  return (
    <div className="steps" role="img" aria-label={t("add.stepOf", { n: step, total: 3 })}>
      {[1, 2, 3].map((n) => (
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
  onNext: () => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | undefined>();
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!props.name.trim()) {
      setError(t("pair.nameRequired"));
      document.getElementById("add-name")?.focus();
      return;
    }
    props.onNext();
  }
  return (
    <>
      <PageTitle sub={t("add.whoIntro")}>{t("add.whoTitle")}</PageTitle>
      <form onSubmit={submit} noValidate className="stack">
        <fieldset className="choices">
          <legend className="sr-only">{t("pair.profile")}</legend>
          {(["child", "self"] as const).map((p) => (
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
              id="add-name"
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
        <div>
          <button type="submit" className="btn btn-primary">
            {t("add.next")}
          </button>
        </div>
        <p className="muted small">
          {t("add.haveCode")} <Link to="/pair">{t("add.useCode")}</Link>
        </p>
      </form>
    </>
  );
}

function PinStep({ onBack, onDone }: { onBack?: () => void; onDone: (pin: string) => Promise<void> }) {
  const { t } = useI18n();
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [errors, setErrors] = useState<{ pin?: string; again?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const next: typeof errors = {};
    if (!isValidPin(pin)) next.pin = t("add.pinInvalid");
    else if (pin !== again) next.again = t("add.pinMismatch");
    setErrors(next);
    if (next.pin) return document.getElementById("add-pin")?.focus();
    if (next.again) return document.getElementById("add-pin-again")?.focus();
    setBusy(true);
    try {
      await onDone(pin);
    } catch (err) {
      setFormError(errorMessage(err, t));
      setBusy(false);
    }
  }

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 12);
  return (
    <>
      <PageTitle sub={t("add.pinIntro")}>{t("add.pinTitle")}</PageTitle>
      <form onSubmit={submit} noValidate className="stack">
        <Field label={t("add.pin")} help={t("add.pinHelp")} error={errors.pin}>
          {(p) => (
            <input
              {...p}
              id="add-pin"
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
              id="add-pin-again"
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
        <LiveStatus notice={formError ? { tone: "error", text: formError } : null} />
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t("add.making") : t("add.makeQr")}
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
  const navigate = useNavigate();
  const [paired, setPaired] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Wait for the phone: it pairs itself with the token as soon as setup is done.
  useEffect(() => {
    if (paired) return;
    let stop = false;
    const id = window.setInterval(async () => {
      try {
        const p = await api.get<Phone>(`/phones/${qr.phoneId}`);
        if (!stop && p.pairedAt) setPaired(true);
      } catch {
        // A network hiccup: try again on the next tick.
      }
    }, 4_000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [qr.phoneId, paired]);

  useEffect(() => {
    if (paired) headingRef.current?.focus();
  }, [paired]);

  const expires = new Intl.DateTimeFormat(locale === "da" ? "da-DK" : "en-GB", {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(qr.expiresAt));

  if (paired) {
    return (
      <div className="setup-done">
        <PageTitle sub={t("add.pairedBody")}>{t("add.pairedTitle", { name: qr.name })}</PageTitle>
        <button type="button" className="btn btn-primary" onClick={() => navigate(`/phones/${qr.phoneId}`, { replace: true })}>
          {t("setup.open", { name: qr.name })}
        </button>
      </div>
    );
  }

  return (
    <>
      <PageTitle sub={t("add.qrIntro")}>{t("add.qrTitle", { name: qr.name })}</PageTitle>
      <div className="setup-grid">
        <QrImage modules={qr.modules} label={t("add.qrAlt")} />
        <div className="setup-side">
          <ol className="setup-steps">
            <li>{t("add.s1")}</li>
            <li>{t("add.s2")}</li>
            <li>{t("add.s3")}</li>
            <li>{t("add.s4")}</li>
          </ol>
          <p className="setup-wait" role="status">
            <span className="pulse" aria-hidden="true" />
            {t("add.waiting")}
          </p>
          <p className="muted small">{t("add.qrPrivate", { when: expires })}</p>
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

/** Black on white with a quiet zone, also in dark mode, so every camera can read it. */
function QrImage({ modules, label }: { modules: boolean[][]; label: string }) {
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
