// SPDX-License-Identifier: Apache-2.0
import { useRouter } from "expo-router";
import { type ComponentRef, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, findNodeHandle, Platform, Share, View } from "react-native";
import { ApiError, client, unwrap } from "../api/client";
import type { InviteResult, Members } from "../api/models";
import { PlanCard } from "../components/Billing";
import { ItemRow } from "../components/parts";
import { HouseholdName } from "../components/HouseholdName";
import { HouseholdPicker } from "../components/HouseholdPicker";
import { RequireAuth } from "../components/RequireAuth";
import { ResetProtection } from "../components/ResetProtection";
import { Button, Card, errorMessage, Field, LiveStatus, LoadGate, Notice, type NoticeValue, PageTitle, Row, Screen, Stack as VStack, Text, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { useActiveHousehold, useMe, useSession } from "../lib/session";
import { space } from "../lib/theme";
import { EMAIL_RE } from "../lib/validate";
import { formatDateTime } from "@plainphone/shared/format";
import { householdTitle } from "@plainphone/shared/household";

function Household() {
  const { t, locale } = useI18n();
  const me = useMe();
  const { refresh } = useSession();
  const router = useRouter();
  const household = useActiveHousehold();
  const res = useLoad<Members | null>(
    () =>
      household
        ? unwrap<Members>(client.GET("/households/{hid}/members", { params: { path: { hid: household.id } } }))
        : Promise.resolve(null),
    [household?.id],
  );
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Removing a parent (or leaving) cuts them off the phones and their SOS alerts, so it asks first.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // The button unmounts when the question opens (and the reverse on Cancel), so screen-reader focus is moved by hand.
  const question = useRef<ComponentRef<typeof View>>(null);
  const removeButtons = useRef(new Map<string, ComponentRef<typeof View> | null>());
  const lastConfirming = useRef<string | null>(null);
  useEffect(() => {
    const node = confirmingId ? question.current : lastConfirming.current ? removeButtons.current.get(lastConfirming.current) : null;
    const handle = node && Platform.OS !== "web" ? findNodeHandle(node) : null;
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    lastConfirming.current = confirmingId;
  }, [confirmingId]);
  const [notice, setNotice] = useState<NoticeValue | null>(null);
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);

  if (!household) {
    return (
      <Screen testID="household">
        <PageTitle>{t("house.title")}</PageTitle>
        <Text variant="muted">{t("house.none")}</Text>
      </Screen>
    );
  }
  const hid = household.id;
  const isOwner = household.role === "owner";

  async function invite() {
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setEmailError(t("login.invalidEmail"));
      return;
    }
    setEmailError(undefined);
    setNotice(null);
    setLink(null);
    setSending(true);
    try {
      const r = await unwrap<InviteResult>(client.POST("/households/{hid}/invites", { params: { path: { hid } }, body: { email: value, locale } }));
      setEmail("");
      if (r.mailed) setNotice({ tone: "success", text: t("house.inviteMailed", { email: r.email }) });
      else if (r.url) setLink({ url: r.url, email: r.email });
      await res.reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.fields().email) setEmailError(t("login.invalidEmail"));
      else setNotice({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setSending(false);
    }
  }

  async function revoke(id: string) {
    setBusyId(id);
    try {
      await unwrap(client.DELETE("/households/{hid}/invites/{iid}", { params: { path: { hid, iid: id } } }));
      setNotice({ tone: "success", text: t("house.removed") });
      await res.reload();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusyId(null);
    }
  }

  async function removeMember(uid: string) {
    setBusyId(uid);
    try {
      await unwrap(client.DELETE("/households/{hid}/members/{uid}", { params: { path: { hid, uid } } }));
      if (uid === me.user.id) {
        await refresh();
        router.replace("/");
        return;
      }
      setConfirmingId(null);
      setNotice({ tone: "success", text: t("house.removed") });
      await res.reload();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError && err.status === 409 ? t("house.lastMember") : errorMessage(err, t) });
    } finally {
      setBusyId(null);
    }
  }

  /** Web copies the link; on a phone the share sheet offers Copy, Messages, Mail and so on. */
  async function shareLink(url: string) {
    try {
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(url);
        setNotice({ tone: "success", text: t("house.copied") });
      } else {
        await Share.share({ message: url });
      }
    } catch {
      // The link is selectable on screen as a fallback.
    }
  }

  return (
    <Screen testID="household" onRefresh={() => void res.reload()} refreshing={res.loading && res.data !== undefined}>
      <PageTitle sub={t("house.intro")}>{householdTitle(household.name, t("house.title"))}</PageTitle>
      <HouseholdPicker />
      <LiveStatus notice={notice} onClose={() => setNotice(null)} />
      <HouseholdName key={hid} household={household} notify={setNotice} />
      <LoadGate res={res}>
        {(data) =>
          data && (
            <>
              <VStack>
                <Text variant="heading">{t("house.members")}</Text>
                <VStack gap={space.sm}>
                  {data.members.map((m) => {
                    const self = m.id === me.user.id;
                    const canRemove = data.members.length > 1 && (self || isOwner);
                    return (
                      <ItemRow
                        key={m.id}
                        testID={`member-${m.id}`}
                        title={self ? `${m.email} (${t("house.you")})` : m.email}
                        meta={t(m.role === "owner" ? "house.owner" : "house.parent")}
                      >
                        {canRemove && confirmingId === m.id ? (
                          <VStack>
                            <View ref={question} accessible>
                              <Text>{self ? t("house.leaveQuestion") : t("house.removeQuestion", { email: m.email })}</Text>
                            </View>
                            <Row>
                              <Button
                                testID={`member-remove-confirm-${m.id}`}
                                kind="danger"
                                title={self ? t("house.leaveYes") : t("house.removeYes")}
                                busy={busyId === m.id}
                                onPress={() => void removeMember(m.id)}
                              />
                              <Button kind="secondary" title={t("app.cancel")} disabled={busyId === m.id} onPress={() => setConfirmingId(null)} />
                            </Row>
                          </VStack>
                        ) : canRemove ? (
                          <Button
                            ref={(node) => {
                              removeButtons.current.set(m.id, node);
                            }}
                            kind="secondary"
                            title={self ? t("house.leave") : t("app.remove")}
                            accessibilityLabel={self ? undefined : t("house.removeLabel", { email: m.email })}
                            onPress={() => setConfirmingId(m.id)}
                          />
                        ) : null}
                      </ItemRow>
                    );
                  })}
                </VStack>
              </VStack>
              {data.invites.length > 0 ? (
                <VStack>
                  <Text variant="heading">{t("house.invites")}</Text>
                  <VStack gap={space.sm}>
                    {data.invites.map((i) => (
                      <ItemRow key={i.id} title={i.email} meta={t("house.inviteExpires", { time: formatDateTime(i.expiresAt, locale) })}>
                        <Button
                          kind="secondary"
                          title={t("house.revoke")}
                          accessibilityLabel={t("house.revokeLabel", { email: i.email })}
                          busy={busyId === i.id}
                          onPress={() => void revoke(i.id)}
                        />
                      </ItemRow>
                    ))}
                  </VStack>
                </VStack>
              ) : null}
            </>
          )
        }
      </LoadGate>

      <PlanCard />

      <ResetProtection hid={hid} />

      <Card>
        <Text variant="heading">{t("house.inviteTitle")}</Text>
        <Field
          testID="invite-email"
          label={t("house.inviteEmail")}
          error={emailError}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="send"
          onSubmitEditing={() => void invite()}
        />
        <Button testID="invite-send" title={sending ? t("login.sending") : t("house.inviteSend")} busy={sending} onPress={() => void invite()} />
        {link ? (
          <Notice tone="warn" text={t("house.inviteLink", { email: link.email })}>
            <Text variant="mono" selectable style={{ fontSize: 14, lineHeight: 20 }}>
              {link.url}
            </Text>
            <Button
              testID="invite-share"
              kind="secondary"
              title={t(Platform.OS === "web" ? "house.copy" : "native.shareLink")}
              onPress={() => void shareLink(link.url)}
            />
          </Notice>
        ) : null}
      </Card>
    </Screen>
  );
}

export default function HouseholdScreen() {
  return (
    <RequireAuth>
      <Household />
    </RequireAuth>
  );
}
