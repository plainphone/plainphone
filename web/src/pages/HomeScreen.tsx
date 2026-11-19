// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { Field, LoadGate, PageTitle, PickGroup, type PickOption, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import type { MessageKey } from "../i18n/translate";
import { api, ApiError, type App, getHome, type Home, putHome } from "../lib/api";
import { formatClock, intlLocale } from "../lib/format";
import { HOME_LAYOUTS, HOME_MAX_APPS, HOME_PALETTES, HOME_THEMES, moveItem } from "../lib/settings";
import { usePhone } from "./Phone";

interface Data {
  home: Home;
  apps: App[];
}

export function HomeScreenPage() {
  const { t } = useI18n();
  const { phone } = usePhone();
  const res = useLoad(async (): Promise<Data> => {
    const [home, apps] = await Promise.all([getHome(phone.id), api.get<{ apps: App[] }>(`/phones/${phone.id}/apps`)]);
    return { home, apps: apps.apps };
  }, [phone.id]);

  return (
    <>
      <PageTitle sub={t("home.intro")}>{t("home.title")}</PageTitle>
      <LoadGate res={res}>{({ home, apps }) => <HomeEditor initial={home} apps={apps} />}</LoadGate>
    </>
  );
}

/** Where keyboard focus goes after the list changes, so moving an app does not drop it. */
type FocusTarget = { pkg: string; dir: "up" | "down" | "remove" } | "add";

function HomeEditor({ initial, apps }: { initial: Home; apps: App[] }) {
  const { t, locale } = useI18n();
  const { phone, run, notify } = usePhone();
  const [home, setHome] = useState<Home>(initial);
  const [announce, setAnnounce] = useState("");
  const [toAdd, setToAdd] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLSelectElement>(null);
  const focusRef = useRef<FocusTarget | null>(null);

  // Every change is saved at once. Quick changes are sent one after the other, newest last,
  // so a slow answer can never overwrite a newer choice.
  const latest = useRef(initial);
  const dirty = useRef(false);
  const sending = useRef(false);

  async function flush() {
    if (sending.current) return;
    sending.current = true;
    let failed = false;
    try {
      while (dirty.current) {
        dirty.current = false;
        try {
          if ((await run(() => putHome(phone.id, latest.current), t("app.saved"))) === null) failed = true;
        } catch (err) {
          failed = true;
          if (err instanceof ApiError) notify({ tone: "error", text: t("error.generic") });
        }
      }
    } finally {
      sending.current = false;
    }
    if (failed) {
      // Show what the server has, so the page never claims more than was saved.
      try {
        const fresh = await getHome(phone.id);
        latest.current = fresh;
        setHome(fresh);
      } catch {
        // the error note is already showing
      }
    }
  }

  function update(patch: Partial<Home>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setHome(next);
    dirty.current = true;
    void flush();
  }

  const byPackage = useMemo(() => new Map(apps.map((a) => [a.packageName, a])), [apps]);
  const labelOf = (pkg: string) => byPackage.get(pkg)?.label ?? pkg;
  /** The phone only shows apps the rules allow. */
  const shownOnPhone = (pkg: string) => {
    const a = byPackage.get(pkg);
    return Boolean(a && (a.allowed || a.core));
  };
  const addable = useMemo(
    () =>
      apps
        .filter((a) => (a.allowed || a.core) && !home.apps.includes(a.packageName))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [apps, home.apps, locale],
  );
  const full = home.apps.length >= HOME_MAX_APPS;

  // After a move or a removal React has re-rendered the list: put focus back where it was.
  useEffect(() => {
    const f = focusRef.current;
    if (!f) return;
    focusRef.current = null;
    if (f === "add") {
      addRef.current?.focus();
      return;
    }
    const find = (dir: string) =>
      listRef.current?.querySelector<HTMLButtonElement>(`[data-pkg="${f.pkg}"][data-dir="${dir}"]`) ?? null;
    const first = find(f.dir);
    // The button at the end of the list is disabled: use the other direction.
    const fallback = f.dir === "remove" ? null : find(f.dir === "up" ? "down" : "up");
    (first && !first.disabled ? first : fallback)?.focus();
  }, [home.apps]);

  function move(index: number, delta: -1 | 1) {
    const pkg = home.apps[index];
    if (!pkg) return;
    focusRef.current = { pkg, dir: delta < 0 ? "up" : "down" };
    setAnnounce(t("home.moved", { app: labelOf(pkg), pos: index + delta + 1, total: home.apps.length }));
    update({ apps: moveItem(home.apps, index, delta) });
  }

  function remove(index: number) {
    const pkg = home.apps[index];
    if (!pkg) return;
    const rest = home.apps.filter((p) => p !== pkg);
    const neighbour = rest[index] ?? rest[index - 1];
    focusRef.current = neighbour ? { pkg: neighbour, dir: "remove" } : "add";
    setAnnounce(t("home.removed", { app: labelOf(pkg) }));
    update({ apps: rest });
  }

  function add(e: FormEvent) {
    e.preventDefault();
    if (!toAdd || full || home.apps.includes(toAdd)) return;
    setAnnounce(t("home.added", { app: labelOf(toAdd) }));
    update({ apps: [...home.apps, toAdd] });
    setToAdd("");
    focusRef.current = "add";
  }

  const layoutId = useId();
  const themeId = useId();
  const paletteId = useId();
  const layoutOptions: PickOption<Home["layout"]>[] = HOME_LAYOUTS.map((v) => ({ value: v, label: t(`home.layout.${v}` as MessageKey) }));
  const themeOptions: PickOption<Home["theme"]>[] = HOME_THEMES.map((v) => ({ value: v, label: t(`home.theme.${v}` as MessageKey) }));
  const paletteOptions: PickOption<Home["palette"]>[] = HOME_PALETTES.map((v) => ({
    value: v,
    label: t(`home.palette.${v}` as MessageKey),
    mark: <span className="swatch" data-palette={v} aria-hidden="true" />,
  }));

  return (
    <>
      <HomePreview
        home={home}
        locale={locale}
        rows={home.apps.filter(shownOnPhone).map(labelOf)}
      />

      <ul className="list">
        <li className="setting">
          <p className="row-title" id={layoutId}>
            {t("home.layout")}
          </p>
          <PickGroup name="home-layout" value={home.layout} options={layoutOptions} onChange={(layout) => update({ layout })} labelledBy={layoutId} />
        </li>
        <li className="setting">
          <p className="row-title" id={themeId}>
            {t("home.theme")}
          </p>
          <PickGroup name="home-theme" value={home.theme} options={themeOptions} onChange={(theme) => update({ theme })} labelledBy={themeId} />
        </li>
        <li className="setting">
          <p className="row-title" id={paletteId}>
            {t("home.palette")}
          </p>
          <PickGroup name="home-palette" value={home.palette} options={paletteOptions} onChange={(palette) => update({ palette })} labelledBy={paletteId} />
        </li>
      </ul>

      <section className="section" aria-labelledby="home-apps-h">
        <h2 id="home-apps-h">{t("home.apps")}</h2>
        <p className="help">{t("home.appsHelp", { max: HOME_MAX_APPS })}</p>
        {home.apps.length === 0 ? (
          <p className="empty-inline">{t("home.appsEmpty")}</p>
        ) : (
          <ol className="list home-apps" ref={listRef} aria-label={t("home.listLabel")}>
            {home.apps.map((pkg, i) => {
              const label = labelOf(pkg);
              return (
                <li key={pkg} className="home-app">
                  <span className="home-app-pos" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="home-app-main">
                    <span className="row-title">{label}</span>
                    {!shownOnPhone(pkg) && <span className="row-meta">{t("home.hiddenApp")}</span>}
                  </span>
                  <span className="home-app-actions">
                    <button
                      type="button"
                      className="btn-icon"
                      data-pkg={pkg}
                      data-dir="up"
                      disabled={i === 0}
                      aria-label={t("home.moveUp", { app: label })}
                      onClick={() => move(i, -1)}
                    >
                      <Arrow dir="up" />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      data-pkg={pkg}
                      data-dir="down"
                      disabled={i === home.apps.length - 1}
                      aria-label={t("home.moveDown", { app: label })}
                      onClick={() => move(i, 1)}
                    >
                      <Arrow dir="down" />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      data-pkg={pkg}
                      data-dir="remove"
                      aria-label={t("home.removeApp", { app: label })}
                      onClick={() => remove(i)}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {full ? (
          <p className="help home-note">{t("home.full", { max: HOME_MAX_APPS })}</p>
        ) : addable.length === 0 ? (
          <p className="help home-note">{t("home.addNone")}</p>
        ) : (
          <form onSubmit={add} className="inline-form">
            <Field label={t("home.add")}>
              {(p) => (
                <select {...p} ref={addRef} value={toAdd} onChange={(e) => setToAdd(e.target.value)}>
                  <option value="">{t("home.addChoose")}</option>
                  {addable.map((a) => (
                    <option key={a.packageName} value={a.packageName}>
                      {a.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <button type="submit" className="btn btn-primary" disabled={!toAdd}>
              {t("app.add")}
            </button>
          </form>
        )}
        <p className="sr-only" role="status" aria-live="polite">
          {announce}
        </p>
      </section>
    </>
  );
}

function Arrow({ dir }: { dir: "up" | "down" }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false" className="arrow">
      <path d={dir === "up" ? "M5 12.5 10 7.5l5 5" : "M5 7.5l5 5 5-5"} />
    </svg>
  );
}

/** A small, still picture of the front page. It follows the choices and does nothing itself. */
function HomePreview({ home, rows, locale }: { home: Home; rows: string[]; locale: import("../lib/api").Locale }) {
  const { t } = useI18n();
  const date = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  // Until apps are chosen, the phone shows Phone and Messages.
  const shown = home.apps.length === 0 ? [t("home.previewPhone"), t("home.previewMessages")] : rows;
  return (
    <section className="home-preview" aria-hidden="true">
      <p className="hp-caption">{t("home.preview")}</p>
      <div className="hp" data-theme={home.theme} data-palette={home.palette}>
        <div>
          <p className="hp-clock">{formatClock(12 * 60 + 30, locale)}</p>
          <p className="hp-date">{date}</p>
        </div>
        <ul className={`hp-apps${home.layout === "grid" ? " hp-apps-grid" : ""}`}>
          {shown.map((label, i) => (
            <li key={`${i}-${label}`}>{label}</li>
          ))}
        </ul>
        <p className="hp-foot">
          <span>{t("home.previewPhone")}</span>
          <span>{t("home.previewEmergency")}</span>
          <span className="hp-all">{t("home.previewAllApps")}</span>
        </p>
      </div>
    </section>
  );
}
