// SPDX-License-Identifier: Apache-2.0
import { useRouter } from "expo-router";
import { Linking } from "react-native";
import { useRef, useState } from "react";
import { ApiError, client, unwrap } from "../api/client";
import type { Approval } from "../api/models";
import { ScanCode } from "../components/ScanCode";
import { ApprovalQueue } from "../components/ApprovalQueue";
import { RequireAuth } from "../components/RequireAuth";
import { Button, errorMessage, LiveStatus, LoadGate, type NoticeValue, PageTitle, Screen, Text, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { SERVER_URL } from "../lib/config";
import { savePendingInvite } from "../lib/pendingInvite";
import { type ApprovalOutcome, type Decision, decisionOutcome, isFinal, outcomeKey, outcomeOf, type Processed, queueOf } from "../shared/lib/approval-state";

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
  const { t } = useI18n();
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const selected = code?.split(".")[1];
  const res = useLoad(() => unwrap<{ approvals: Approval[] }>(client.GET("/approvals")).then((r) => r.approvals), []);
  const [busy, setBusy] = useState<string | null>(null);
  const sending = useRef(false);
  const [notice, setNotice] = useState<NoticeValue | null>(null);
  const [processed, setProcessed] = useState<Record<string, Processed<Approval>>>({});
  const [focusId, setFocusId] = useState<string | null>(null);

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

  async function decide(a: Approval, action: Decision) {
    // One answer at a time: a double tap must not send it twice.
    if (sending.current) return;
    sending.current = true;
    setBusy(a.id);
    setNotice(null);
    let outcome: ApprovalOutcome | null = null;
    try {
      const path = { params: { path: { cid: a.id } } };
      if (code && action === "approve") {
        await unwrap(client.POST("/changes/{cid}/approve-qr", { ...path, body: { challenge: code, revision: a.revision } }));
        setCode(null);
      } else await unwrap(action === "approve" ? client.POST("/changes/{cid}/approve", { ...path, body: { revision: a.revision } }) : client.POST("/changes/{cid}/reject", path));
      outcome = decisionOutcome(action);
    } catch (err) {
      outcome = err instanceof ApiError && err.status === 409 ? outcomeOf(err.data) : null;
      if (!outcome) setNotice({ tone: "error", text: err instanceof ApiError && err.status === 409 ? t(code ? "appr.codeUnavailable" : "appr.previewChanged") : errorMessage(err, t) });
    } finally {
      sending.current = false;
      setBusy(null);
    }
    if (outcome) {
      const final = isFinal(outcome);
      const answered = outcome;
      const text = t(outcomeKey(outcome, action));
      if (final) {
        setProcessed((all) => (all[a.id] ? all : { ...all, [a.id]: { approval: a, outcome: answered, decision: action } }));
        setFocusId(a.id);
        // The answered row takes focus and its label carries the result, so the screen reader hears it once.
      } else setNotice({ tone: "error", text });
    }
    await res.reload();
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
          const queue = queueOf(list, processed);
          const open = queue.open;
          const done = code ? queue.done.filter((d) => d.approval.id === selected) : queue.done;
          return open.length === 0 && done.length === 0 ? (
            <Text variant="muted">{t(code ? "appr.codeUnavailable" : "appr.empty")}</Text>
          ) : (
            <ApprovalQueue open={open} done={done} busy={busy} approveOnly={code !== null} focusId={focusId} onDecide={(a, action) => void decide(a, action)} />
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
