// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { ApiError, client, unwrap } from "../api/client";
import type { Approval } from "../api/models";
import { ItemRow } from "../components/parts";
import { RequireAuth } from "../components/RequireAuth";
import { Button, errorMessage, List, LiveStatus, LoadGate, type NoticeValue, PageTitle, Row, Screen, Text, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { space } from "../lib/theme";
import { formatDateTime } from "../shared/lib/format";
import { describeOp } from "../shared/lib/ops";

function ApprovalsList() {
  const { t, locale } = useI18n();
  const res = useLoad(() => unwrap<{ approvals: Approval[] }>(client.GET("/approvals")).then((r) => r.approvals), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeValue | null>(null);

  async function decide(a: Approval, action: "approve" | "reject") {
    setBusy(a.id);
    setNotice(null);
    try {
      const path = { params: { path: { cid: a.id } } };
      await unwrap(action === "approve" ? client.POST("/changes/{cid}/approve", path) : client.POST("/changes/{cid}/reject", path));
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
      <LiveStatus notice={notice} onClose={() => setNotice(null)} />
      <LoadGate res={res}>
        {(list) =>
          list.length === 0 ? (
            <Text variant="muted" style={{ paddingHorizontal: space.xs }}>{t("appr.empty")}</Text>
          ) : (
            <List>
              {list.map((a) => {
                const what = describeOp(a.op, t, locale, (pkg) => a.appLabel ?? pkg);
                const from = a.requestedBy ? t("appr.from", { phone: a.phoneName, email: a.requestedBy }) : t("appr.fromPhone", { phone: a.phoneName });
                return (
                  <ItemRow key={a.id} testID={`approval-${a.id}`} title={what} meta={`${from}\n${t("appr.asked", { time: formatDateTime(a.createdAt, locale) })}`} stacked>
                    <Row>
                      <Button
                        kind="primary"
                        title={t("appr.approve")}
                        accessibilityLabel={`${t("appr.approve")}: ${what}`}
                        disabled={busy === a.id}
                        busy={busy === a.id}
                        onPress={() => void decide(a, "approve")}
                      />
                      <Button
                        kind="plain"
                        title={t("appr.reject")}
                        accessibilityLabel={`${t("appr.reject")}: ${what}`}
                        disabled={busy === a.id}
                        onPress={() => void decide(a, "reject")}
                      />
                    </Row>
                  </ItemRow>
                );
              })}
            </List>
          )
        }
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
