// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { errorNotice, Field, LiveStatus, type Notice, PageTitle, Switch } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, ApiError, type Phone, type Profile } from "../lib/api";
import { normaliseCode } from "@plainphone/shared/format";
import { useHouseholdId } from "../lib/session";
import { IOS_PAIRING_NOT_YET } from "@plainphone/shared/platform";

export function PairPage() {
  const householdId = useHouseholdId();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [code, setCode] = useState(() => normaliseCode(params.get("code") ?? ""));
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<Profile>(() => params.get("profile") === "self" ? "self" : "child");
  const [privateDns, setPrivateDns] = useState(false);
  const [light, setLight] = useState(false);
  const [iphone, setIphone] = useState(false);
  const [hint, setHint] = useState<Profile | null>(null);
  const [lookupPending, setLookupPending] = useState(false);
  const [awaitingPhone, setAwaitingPhone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ code?: string; name?: string }>({});
  const [formError, setFormError] = useState<Notice | null>(null);

  // The code is in state now; keep it out of the address bar and the history.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("code")) return;
    url.searchParams.delete("code");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, []);

  useEffect(() => {
    setHint(null);
    setLight(false);
    setIphone(false);
    if (code.replace(/-/g, "").length !== 8) {
      setLookupPending(false);
      return;
    }
    let current = true;
    setLookupPending(true);
    api.post<{ profile: Profile | null; mode?: "light" | "strong"; platform?: "android" | "ios" }>("/phones/pairing-profile", { code }).then(({ profile: suggested, mode, platform }) => {
      if (!current) return;
      setHint(suggested);
      setLight(mode === "light");
      setIphone(platform === "ios");
      if (suggested) setProfile(suggested);
    }).catch(() => {
      // Claim still validates the code and selected profile on the server.
    }).finally(() => {
      if (current) setLookupPending(false);
    });
    return () => { current = false; };
  }, [code]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const next: typeof errors = {};
    if (code.replace(/-/g, "").length !== 8) next.code = t("pair.codeInvalid");
    if (!name.trim()) next.name = t("pair.nameRequired");
    setErrors(next);
    if (next.code || next.name) return;
    setBusy(true);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const phone = await api.post<Phone>("/phones/claim", { code, name: name.trim(), profile, timezone, householdId, ...(light && !iphone && profile === "self" && privateDns ? { filterMethod: "privateDns" } : {}) });
      if (phone.pairedAt === null) setAwaitingPhone(true);
      else navigate(`/phones/${phone.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.data.code === IOS_PAIRING_NOT_YET) setFormError({ tone: "error", text: t("platform.iphone.notYet") });
      else if (err instanceof ApiError && err.status === 409) setFormError({ tone: "error", text: t("pair.profileMismatch") });
      else if (err instanceof ApiError && err.status === 404) setErrors({ code: t("pair.codeNotFound") });
      else if (err instanceof ApiError && err.status === 400 && err.issues.length) {
        const f = err.fields();
        setErrors({ code: f.code ? t("pair.codeInvalid") : undefined, name: f.name ? t("pair.nameRequired") : undefined });
        setFormError({ tone: "error", text: t("error.form") });
      } else setFormError(errorNotice(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <p className="back">
        <Link to="/">{t("nav.phones")}</Link>
      </p>
      <PageTitle sub={t("pair.intro")}>{t("pair.title")}</PageTitle>
      {awaitingPhone ? <LiveStatus notice={{ tone: "success", text: t("pair.confirmOnPhone") }} /> :
      <form onSubmit={submit} noValidate className="stack">
        <Field label={t("pair.code")} help={t("pair.codeHelp")} error={errors.code}>
          {(p) => (
            <input
              {...p}
              className="input-code"
              name="code"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="K7MP-4QXR"
              value={code}
              onChange={(e) => setCode(normaliseCode(e.target.value))}
            />
          )}
        </Field>
        <Field label={t("pair.name")} help={t("pair.nameHelp")} error={errors.name}>
          {(p) => (
            <input {...p} name="name" maxLength={40} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <fieldset className="choices">
          <legend>{t("pair.profile")}</legend>
          {hint && <p>{t("pair.profileFromPhone")}</p>}
          {(["child", "self"] as const).map((p) => (
            <label key={p} className="choice">
              <input type="radio" name="profile" value={p} checked={profile === p} disabled={hint !== null && hint !== p} onChange={() => setProfile(p)} />
              <span>
                <span className="choice-title">{t(p === "child" ? "profile.child" : "profile.self")}</span>
                <span className="choice-desc">{t(p === "child" ? "profile.childHelp" : "profile.selfHelp")}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {iphone && <p className="notice notice-info">{t("platform.iphone.pairNote")}</p>}
        {light && !iphone && profile === "self" && (
          <Switch label={t("filter.otherVpn")} checked={privateDns} onChange={setPrivateDns}
            description={privateDns ? t("filter.tailscaleTip") : t("filter.methodHelp")} />
        )}
        <LiveStatus notice={formError} />
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy || lookupPending}>
            {busy ? t("pair.adding") : t("pair.submit")}
          </button>
        </div>
      </form>}
    </div>
  );
}
