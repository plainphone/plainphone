// SPDX-License-Identifier: Apache-2.0

export function filterStatusKey(status?: {
  filterMethod?: "vpn" | "privateDns";
  filterWorking?: boolean;
  filterIssue?: "off" | "automatic" | "wrongHost" | "waiting" | "unverified";
} | null) {
  if (status?.filterWorking === undefined) return undefined;
  if (status.filterMethod === "vpn") return status.filterWorking ? "filter.vpnWorking" : "filter.vpnFix";
  if (status.filterMethod !== "privateDns") return undefined;
  if (status.filterWorking) return "filter.privateWorking";
  switch (status.filterIssue) {
    case "off": return "filter.privateOff";
    case "automatic": return "filter.privateAutomatic";
    case "wrongHost": return "filter.privateWrongHost";
    case "waiting": return "filter.privateWaiting";
    default: return "filter.privateUnverified";
  }
}
