// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { ApiError, client, unwrap } from "../../../api/client";
import { type ChangeResult, DNS_CATEGORIES, type DnsCategory, type DnsState } from "../../../api/models";
import { Disclosure, ItemRow } from "../../../components/parts";
import { PhoneGate, usePhone } from "../../../components/PhoneContext";
import { Button, errorMessage, Field, List, LoadGate, Notice, PageTitle, Screen, Section, Switch, Text, useLoad } from "../../../components/ui";
import { useI18n } from "../../../i18n/I18n";
import { space } from "../../../lib/theme";
import { cleanDomain, DOMAIN_RE } from "../../../lib/validate";
import { categoryLabel } from "../../../shared/lib/ops";

function FilterScreenBody() {
  const { t } = useI18n();
  const { phone, run, pending, notify } = usePhone();
  const res = useLoad(() => unwrap<DnsState>(client.GET("/phones/{pid}/dns", { params: { path: { pid: phone.id } } })), [phone.id]);
  const [busy, setBusy] = useState<string | null>(null);

  const waitingCats = new Set(pending.flatMap((c) => (c.op.type === "dns.category" ? [c.op.category] : [])));

  async function setCategory(cat: DnsCategory, blocked: boolean) {
    setBusy(cat);
    try {
      const r = await run(() =>
        unwrap<ChangeResult>(
          client.PUT("/phones/{pid}/dns/categories/{category}", {
            params: { path: { pid: phone.id, category: cat } },
            body: { blocked },
          }),
        ),
      );
      if (r?.status === "applied") {
        res.setData(
          (d) =>
            d && {
              ...d,
              blockedCategories: blocked ? [...d.blockedCategories.filter((c) => c !== cat), cat] : d.blockedCategories.filter((c) => c !== cat),
            },
        );
      }
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen testID="phone-filter" onRefresh={() => void res.reload()} refreshing={res.loading && res.data !== undefined}>
      <PageTitle sub={t("filter.intro")}>{t("filter.title")}</PageTitle>
      <LoadGate res={res}>
        {(dns) => (
          <>
            {!dns.synced ? <Notice tone="info" text={t("filter.notSynced")} /> : null}
            <Section title={t("filter.categories")} help={t("filter.categoriesHelp")}>
              <List>
                {DNS_CATEGORIES.map((cat) => (
                  <Switch
                    key={cat}
                    testID={`category-${cat}`}
                    label={categoryLabel(cat, t)}
                    value={dns.blockedCategories.includes(cat)}
                    disabled={busy === cat}
                    help={waitingCats.has(cat) ? t("pending.waitingTag") : undefined}
                    onValueChange={(v) => void setCategory(cat, v)}
                  />
                ))}
              </List>
            </Section>
            <DomainList kind="allow" domains={dns.allowDomains} onChanged={() => void res.reload()} />
            <DomainList kind="block" domains={dns.blockDomains} onChanged={() => void res.reload()} />
            <Disclosure title={t("filter.technical")}>
              <Text>
                {t("filter.host")}
              </Text>
              <Text variant="mono" selectable>
                {dns.host}
              </Text>
            </Disclosure>
          </>
        )}
      </LoadGate>
    </Screen>
  );
}

function DomainList({ kind, domains, onChanged }: { kind: "allow" | "block"; domains: string[]; onChanged: () => void }) {
  const { t } = useI18n();
  const { phone, run, pending, notify } = usePhone();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const opType = kind === "allow" ? "dns.allowDomain" : "dns.blockDomain";
  const waiting = pending.flatMap((c) => (c.op.type === opType && c.op.present ? [c.op.domain] : []));

  async function add() {
    const domain = cleanDomain(value);
    if (!DOMAIN_RE.test(domain)) {
      setError(t("filter.domainInvalid"));
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      const r = await run(
        () =>
          unwrap<ChangeResult>(
            client.POST("/phones/{pid}/dns/{list}", { params: { path: { pid: phone.id, list: kind } }, body: { domain } }),
          ),
        `${t(kind === "allow" ? "op.allowAdd" : "op.blockAdd", { domain })}.`,
      );
      if (r) {
        setValue("");
        if (r.status === "applied") onChanged();
      }
    } catch (err) {
      if (err instanceof ApiError) setError(t("filter.domainInvalid"));
      else notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  }

  async function remove(domain: string) {
    setRemoving(domain);
    try {
      const r = await run(
        () =>
          unwrap<ChangeResult>(
            client.DELETE("/phones/{pid}/dns/{list}/{domain}", { params: { path: { pid: phone.id, list: kind, domain } } }),
          ),
        `${t(kind === "allow" ? "op.allowRemove" : "op.blockRemove", { domain })}.`,
      );
      if (r?.status === "applied") onChanged();
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setRemoving(null);
    }
  }

  return (
    <Section title={t(kind === "allow" ? "filter.allowTitle" : "filter.blockTitle")} help={t(kind === "allow" ? "filter.allowHelp" : "filter.blockHelp")}>
      {domains.length === 0 && waiting.length === 0 ? (
        <Text variant="muted" style={{ paddingHorizontal: space.xs }}>{t(kind === "allow" ? "filter.noneAllowed" : "filter.noneBlocked")}</Text>
      ) : (
        <List>
          {domains.map((d) => (
            <ItemRow key={d} testID={`${kind}-${d}`} title={d}>
              <Button
                kind="destructive"
                title={t("app.remove")}
                accessibilityLabel={t("filter.removeLabel", { domain: d })}
                busy={removing === d}
                onPress={() => void remove(d)}
              />
            </ItemRow>
          ))}
          {waiting.map((d) => (
            <ItemRow key={`w-${d}`} title={d} tag={t("pending.waitingTag")} waiting />
          ))}
        </List>
      )}
      <Field
        testID={`${kind}-domain`}
        label={t("filter.domain")}
        error={error}
        value={value}
        onChangeText={setValue}
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        placeholder={t("filter.domainPlaceholder")}
        returnKeyType="done"
        onSubmitEditing={() => void add()}
      />
      <Button
        testID={`${kind}-add`}
        kind="secondary"
        title={t(kind === "allow" ? "filter.allowAdd" : "filter.blockAdd")}
        busy={saving}
        onPress={() => void add()}
      />
    </Section>
  );
}

export default function FilterScreen() {
  return (
    <PhoneGate>
      <FilterScreenBody />
    </PhoneGate>
  );
}
