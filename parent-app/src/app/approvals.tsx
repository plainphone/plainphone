// SPDX-License-Identifier: Apache-2.0
import { useRouter } from "expo-router";
import { Linking } from "react-native";
import { useState } from "react";
import { ApiError, client, unwrap } from "../api/client";
import type { Approval } from "../api/models";
import { ScanCode } from "../components/ScanCode";
import { ItemRow } from "../components/parts";
import { RequireAuth } from "../components/RequireAuth";
import { Button, errorMessage, LiveStatus, LoadGate, type NoticeValue, PageTitle, Row, Screen, Stack as VStack, Text, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { SERVER_URL } from "../lib/config";
import { savePendingInvite } from "../lib/pendingInvite";
import { space } from "../lib/theme";
import { formatDateTime } from "../shared/lib/format";
import { describeApproval } from "../shared/lib/ops";

function selfCode(raw: string) {
  try {
    const url = new URL(raw);
    if (url.origin !== new URL(SERVER_URL).origin) return null;
    const params = new URLSearchParams(url.hash.slice(1));
    if (url.pathname === "/approvals" && params.has("code")) return url.href;
    if (url.pathname === "/invite/trusted" && params.get("token")?.startsWith("pp_t_")) return url.href;
    if (url.pathname === "/add" && params.get("template")?.startsWith("pp_r_")) return url.href;
    return null;
  } catch {
    return null;
  }
}

function ApprovalsList() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const selected = code?.split(".")[1];
  const res = useLoad(() => unwrap<{ approvals: Approval[] }>(client.GET("/approvals")).then((r) => r.approvals), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeValue | null>(null);

  async function scan(value: string) {
    const url = new URL(value);
    const params = new URLSearchParams(url.hash.slice(1));
    try {
      if (url.pathname === "/approvals") {
        setCode(params.get("code"));
        await res.reload();
      } else if (url.pathname === "/invite/trusted") {
        const token = params.get("token");
        if (token) {
          await savePendingInvite(token);
          router.push("/invite");
        }
      } else await Linking.openURL(value);
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err, t) });
    }
  }

  async function decide(a: Approval, action: "approve" | "reject") {
    setBusy(a.id);
    setNotice(null);
    try {
      const path = { params: { path: { cid: a.id } } };
      if (code && action === "approve") {
        await unwrap(client.POST("/changes/{cid}/approve-qr", { ...path, body: { challenge: code } }));
        setCode(null);
      } else await unwrap(action === "approve" ? client.POST("/changes/{cid}/approve", path) : client.POST("/changes/{cid}/reject", path));
      setNotice({ tone: "success", text: t(action === "approve" ? "appr.approved" : "appr.rejected") });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError && err.status === 409 ? t("pending.gone") : errorMessage(err, t) });
    } finally {
      setBusy(null);
      await res.reload();
    }
  }

  return (
    <Screen testID="approvals" onRefresh={() => void res.reload()} refreshing={res.loading && res.data !== undefined}>
      <PageTitle sub={t("appr.intro")}>{t("appr.title")}</PageTitle>
      <ScanCode label={t("appr.scan")} parse={selfCode} onCode={(value) => void scan(value)} onStatus={setNotice} />
      {code && <Button kind="secondary" title={t("appr.showAll")} onPress={() => setCode(null)} />}
      <LiveStatus notice={notice} onClose={() => setNotice(null)} />
      <LoadGate res={res}>
        {(all) => {
          const list = code ? all.filter((a) => a.id === selected) : all;
          return list.length === 0 ? (
            <Text variant="muted">{t(code ? "appr.codeUnavailable" : "appr.empty")}</Text>
          ) : (
            <VStack gap={space.sm}>
              {list.map((a) => {
                const what = describeApproval(a.op.type, t, a.appLabel);
                const from = a.requestedBy ? t("appr.from", { phone: a.phoneName, email: a.requestedBy }) : t("appr.fromPhone", { phone: a.phoneName });
                return (
                  <ItemRow key={a.id} testID={`approval-${a.id}`} title={what} meta={`${from}\n${t("appr.asked", { time: formatDateTime(a.createdAt, locale) })}`}>
                    <Row>
                      <Button
                        kind="primary"
                        title={t("appr.approve")}
                        accessibilityLabel={`${t("appr.approve")}: ${what}`}
                        disabled={busy === a.id}
                        busy={busy === a.id}
                        onPress={() => void decide(a, "approve")}
                      />
                      {!code && <Button
                        kind="secondary"
                        title={t("appr.reject")}
                        accessibilityLabel={`${t("appr.reject")}: ${what}`}
                        disabled={busy === a.id}
                        onPress={() => void decide(a, "reject")}
                      />}
                    </Row>
                  </ItemRow>
                );
              })}
            </VStack>
          );
        }}
      </LoadGate>
    </Screen>
  );
}

export default function ApprovalsScreen() {
  return (
    <RequireAuth>
      <ApprovalsList />
    </RequireAuth>
  );
}
