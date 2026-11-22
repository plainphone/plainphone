// SPDX-License-Identifier: Apache-2.0
// Links to plainphone.org in the language of the dashboard.
import { APP_DEFAULT_SERVER_URL } from "./provisioning";

const site = (locale: string, page: string) => `https://plainphone.org${locale === "en" ? "" : `/${locale}`}/${page}/`;

/** The privacy policy on the website. */
export const privacyUrl = (locale: string) => site(locale, "privacy");

/** The terms of the hosted test service on the website (issue #244). */
export const termsUrl = (locale: string) => site(locale, "terms");

/**
 * True when the dashboard is the hosted test service. The terms only cover that service,
 * so a self-hosted dashboard does not show them.
 */
export const isHostedService = (origin: string) => origin === APP_DEFAULT_SERVER_URL;
