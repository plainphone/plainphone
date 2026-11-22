// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { client, unwrap } from "../api/client";
import type { operations } from "@plainphone/api-client/schema";
import { useI18n } from "../i18n/I18n";
import { space } from "../lib/theme";
import { Button, Card, type Loaded, LoadGate, Notice, Stack, Text } from "./ui";

type Suggestion = operations["getContactSuggestions"]["responses"][200]["content"]["application/json"]["suggestions"][number];
type Review = operations["reviewContactSuggestions"]["requestBody"]["content"]["application/json"];

export async function loadContactSuggestions(pid: string): Promise<Suggestion[]> {
  const result = await unwrap<{ suggestions: Suggestion[] }>(
    client.GET("/phones/{pid}/contact-suggestions", { params: { path: { pid } } }),
  );
  return result.suggestions;
}

export function ContactSuggestions({
  pid, result, onApproved,
}: {
  pid: string;
  result: Loaded<Suggestion[]>;
  onApproved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [reviewing, setReviewing] = useState(false);
  const [failed, setFailed] = useState(false);
  const disabled = reviewing || result.loading;

  async function review(body: Review) {
    setReviewing(true);
    setFailed(false);
    try {
      await unwrap(client.POST("/phones/{pid}/contact-suggestions", { params: { path: { pid } }, body }));
      await Promise.all([result.reload(), ...(body.action === "reject" ? [] : [onApproved()])]);
    } catch {
      setFailed(true);
    } finally {
      setReviewing(false);
    }
  }

  return (
    <Stack>
      <Text variant="heading" accessibilityRole="header">{t("contacts.suggestions")}</Text>
      {failed && <Notice tone="error" text={t("contacts.suggestionsError")} />}
      <LoadGate res={result}>
        {(suggestions) => suggestions.length === 0 ? (
          <Text variant="muted">{t("contacts.noSuggestions")}</Text>
        ) : (
          <Stack gap={space.sm}>
            {suggestions.map(({ id, name, numbers }) => (
              <Card key={id}>
                <Text variant="label">{name}</Text>
                {numbers.map((number) => <Text key={number} variant="mono">{number}</Text>)}
                <Button
                  kind="secondary"
                  title={t("contacts.approve")}
                  accessibilityLabel={t("contacts.approveLabel", { name })}
                  disabled={disabled}
                  onPress={() => void review({ action: "approve", id })}
                />
                <Button
                  kind="plain"
                  title={t("contacts.reject")}
                  accessibilityLabel={t("contacts.rejectLabel", { name })}
                  disabled={disabled}
                  onPress={() => void review({ action: "reject", id })}
                />
              </Card>
            ))}
            <Button
              kind="secondary"
              title={t("contacts.approveAll")}
              disabled={disabled}
              onPress={() => void review({ action: "approveAll", suggestionIds: suggestions.map(({ id }) => id) })}
            />
          </Stack>
        )}
      </LoadGate>
    </Stack>
  );
}
