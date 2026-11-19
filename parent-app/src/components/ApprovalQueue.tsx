// SPDX-License-Identifier: Apache-2.0
//
// The requests a trusted person was asked to answer: open ones first, answered ones below with
// their result in place. Same states and copy as the dashboard (src/shared/lib/approval-state).
import { type ComponentRef, useEffect, useRef } from "react";
import { AccessibilityInfo, findNodeHandle, View } from "react-native";
import type { Approval } from "../api/models";
import { useI18n } from "../i18n/I18n";
import { radius, space, useColors } from "../lib/theme";
import { type Decision, outcomeKey, type Processed, queueSummaryKey } from "../shared/lib/approval-state";
import { formatDateTime } from "../shared/lib/format";
import { ItemRow } from "./parts";
import { Button, Row, Stack as VStack, Text } from "./ui";

export interface ApprovalQueueProps {
  open: Approval[];
  done: Processed<Approval>[];
  /** The request being sent. Its buttons are off, so a second tap cannot send it twice. */
  busy: string | null;
  /** A scanned code approves one request. Declining is done from the list. */
  approveOnly: boolean;
  /** The answered request that gets screen-reader focus, so focus does not fall back to the top of the screen. */
  focusId: string | null;
  onDecide: (a: Approval, action: Decision) => void;
}

export function ApprovalQueue({ open, done, busy, approveOnly, focusId, onDecide }: ApprovalQueueProps) {
  const { t, locale } = useI18n();
  const c = useColors();
  const summary = queueSummaryKey(open.length, done.length);
  const answered = useRef<ComponentRef<typeof View>>(null);
  useEffect(() => {
    const node = focusId ? findNodeHandle(answered.current) : null;
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, [focusId]);
  const from = (a: Approval) => (a.requestedBy ? t("appr.from", { phone: a.phoneName, email: a.requestedBy }) : t("appr.fromPhone", { phone: a.phoneName }));
  const meta = (a: Approval) => `${from(a)}\n${t("appr.asked", { time: formatDateTime(a.createdAt, locale) })}`;
  return (
    <VStack gap={space.sm}>
      {summary ? <Text variant="label" testID="queue-summary">{t(summary.key, { n: summary.n })}</Text> : null}
      {open.map((a) => {
        const what = a.summary[locale];
        return (
          <ItemRow key={a.id} testID={`approval-${a.id}`} title={what} meta={meta(a)}>
            <Row>
              <Button
                kind="primary"
                title={t("appr.approve")}
                accessibilityLabel={`${t("appr.approve")}: ${what}`}
                disabled={busy !== null}
                busy={busy === a.id}
                onPress={() => onDecide(a, "approve")}
              />
              {!approveOnly && <Button
                kind="secondary"
                title={t("appr.reject")}
                accessibilityLabel={`${t("appr.reject")}: ${what}`}
                disabled={busy !== null}
                onPress={() => onDecide(a, "reject")}
              />}
            </Row>
          </ItemRow>
        );
      })}
      {done.map(({ approval: a, outcome, decision }) => (
        <View
          key={a.id}
          ref={a.id === focusId ? answered : undefined}
          testID={`answered-${a.id}`}
          accessible
          accessibilityLabel={`${a.summary[locale]}. ${t(outcomeKey(outcome, decision))}`}
          style={{ backgroundColor: c.tint, borderRadius: radius, padding: space.md, gap: 2 }}
        >
          <Text variant="label">{a.summary[locale]}</Text>
          <Text variant="small">{meta(a)}</Text>
          <Text variant="label" style={{ marginTop: space.xs }}>{t(outcomeKey(outcome, decision))}</Text>
        </View>
      ))}
    </VStack>
  );
}
