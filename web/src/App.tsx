// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { Shell } from "./components/Shell";
import { Loading } from "./components/ui";
import { I18nProvider } from "./i18n/I18n";
import { rememberNext, SessionProvider, useSession } from "./lib/session";
import { ApprovalsPage } from "./pages/Approvals";
import { AppsPage } from "./pages/Apps";
import { AuthCallbackPage } from "./pages/AuthCallback";
import { CatalogPage } from "./pages/Catalog";
import { ContactsPage } from "./pages/Contacts";
import { FilterPage } from "./pages/Filter";
import { HomeScreenPage } from "./pages/HomeScreen";
import { HouseholdPage } from "./pages/Household";
import { InstallPhonePage } from "./pages/InstallPhone";
import { InvitePage } from "./pages/Invite";
import { KeyPage } from "./pages/Key";
import { LocationPage } from "./pages/Location";
import { LoginPage } from "./pages/Login";
import { PairPage } from "./pages/Pair";
import { AddPhonePage, SetupPhonePage } from "./pages/AddPhone";
import { PhoneLayout, PhoneOverview } from "./pages/Phone";
import { PhoneSettingsPage } from "./pages/PhoneSettings";
import { GrowingUpPage } from "./pages/GrowingUp";
import { AgreementPage } from "./pages/Agreement";
import { PhonesPage } from "./pages/Phones";
import { SchedulesPage } from "./pages/Schedules";
import { SettingsPage } from "./pages/Settings";
import { SummaryPage } from "./pages/Summary";
import { TimePage } from "./pages/Time";

function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useSession();
  const loc = useLocation();
  if (state.status === "loading") return <Loading />;
  if (state.status === "anon") {
    const approvalFragment = loc.pathname === "/approvals" || loc.pathname === "/add" ? loc.hash : "";
    rememberNext(loc.pathname + loc.search + approvalFragment);
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        {/* Links mailed to the native app; without the app installed they log in here. */}
        <Route path="/auth/app" element={<AuthCallbackPage />} />
        <Route path="/install-phone" element={<InstallPhonePage />} />
        <Route path="/invite" element={<InvitePage />} />
        <Route path="/invite/trusted" element={<InvitePage />} />
        <Route path="/" element={<RequireAuth><PhonesPage /></RequireAuth>} />
        <Route path="/pair" element={<RequireAuth><PairPage /></RequireAuth>} />
        <Route path="/add" element={<RequireAuth><AddPhonePage /></RequireAuth>} />
        <Route path="/phones/:pid/setup" element={<RequireAuth><SetupPhonePage /></RequireAuth>} />
        <Route path="/household" element={<RequireAuth><HouseholdPage /></RequireAuth>} />
        <Route path="/approvals" element={<RequireAuth><ApprovalsPage /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
        <Route path="/summary" element={<RequireAuth><SummaryPage /></RequireAuth>} />
        <Route path="/phones/:pid" element={<RequireAuth><PhoneLayout /></RequireAuth>}>
          <Route index element={<PhoneOverview />} />
          <Route path="apps" element={<AppsPage />} />
          <Route path="apps/add" element={<CatalogPage />} />
          <Route path="time" element={<TimePage />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="filter" element={<FilterPage />} />
          <Route path="schedules" element={<SchedulesPage />} />
          <Route path="location" element={<LocationPage />} />
          <Route path="settings" element={<PhoneSettingsPage />} />
          <Route path="home" element={<HomeScreenPage />} />
          <Route path="key" element={<KeyPage />} />
          <Route path="growing" element={<GrowingUpPage />} />
          <Route path="agreement" element={<AgreementPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <I18nProvider>
      <SessionProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </SessionProvider>
    </I18nProvider>
  );
}
