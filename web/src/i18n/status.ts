// SPDX-License-Identifier: Apache-2.0
//
// Status copy shared by the dashboard and the parent app: what state a phone is in, and what
// happened to a request a trusted person was asked to decide. Kept in its own file so the
// main catalogues only spread it in. Never use em dashes in copy.

export const statusEn = {
  "status.never.title": "Not connected yet",
  "status.never.hint": "Finish setting up the phone, and it will show here when it connects.",
  "status.stale.title": "Last online {when}",
  "status.stale.hint": "The rules below are the last ones the phone confirmed. New changes wait until it is online again.",
  "status.noReport.title": "Online {when}",
  "status.noReport.hint": "The phone has been online. It has not yet confirmed which rules apply.",
  "status.waiting.title": "Waiting for the phone",
  "status.waiting.hint": "Your latest change has not reached the phone yet. It applies the next time the phone is online.",
  "status.applied.title": "Rules confirmed",
  "status.applied.hint": "The phone confirmed the current rules {when}.",

  "status.outcome.approvedByYou": "Approved. The phone applies it the next time it is online.",
  "status.outcome.approvedByOther": "Someone else already approved this request.",
  "status.outcome.declinedByYou": "Declined. The phone keeps its current rule.",
  "status.outcome.declinedByOther": "Someone else already declined this request.",
  "status.outcome.cancelled": "The request was withdrawn. Nothing changed.",
  "status.outcome.failed": "This change could not be applied. Ask for a new one.",
  "status.outcome.changed": "Review the updated request before approving.",
  "status.outcome.codeExpired": "This code has expired. Ask the phone for a new one.",
  "status.conflict.approvedByYou": "You already approved this request, so it stays approved.",
  "status.conflict.declinedByYou": "You already declined this request, so it stays declined.",
  "status.queue.one": "1 request waits for you",
  "status.queue.many": "{n} requests wait for you",
  "status.queue.done": "You have answered every request.",
  "status.answered": "Answered",
} as const;

export const statusDa: Record<keyof typeof statusEn, string> = {
  "status.never.title": "Ikke forbundet endnu",
  "status.never.hint": "Gør opsætningen af telefonen færdig, så kan du se her, når den bliver forbundet.",
  "status.stale.title": "Sidst online {when}",
  "status.stale.hint": "Reglerne nedenfor er de seneste, telefonen har bekræftet. Nye ændringer venter, til den er online igen.",
  "status.noReport.title": "Online {when}",
  "status.noReport.hint": "Telefonen har været online. Den har endnu ikke svaret på, hvilke regler der gælder.",
  "status.waiting.title": "Venter på telefonen",
  "status.waiting.hint": "Din seneste ændring er ikke nået frem til telefonen endnu. Den gælder, næste gang telefonen er online.",
  "status.applied.title": "Regler bekræftet",
  "status.applied.hint": "Telefonen bekræftede de nuværende regler {when}.",

  "status.outcome.approvedByYou": "Godkendt. Telefonen bruger den, næste gang den er online.",
  "status.outcome.approvedByOther": "En anden har allerede godkendt anmodningen.",
  "status.outcome.declinedByYou": "Afvist. Telefonen beholder sin nuværende regel.",
  "status.outcome.declinedByOther": "En anden har allerede afvist anmodningen.",
  "status.outcome.cancelled": "Anmodningen blev trukket tilbage. Intet er ændret.",
  "status.outcome.failed": "Ændringen kunne ikke gennemføres. Bed om en ny.",
  "status.outcome.changed": "Se den opdaterede anmodning, før du godkender.",
  "status.outcome.codeExpired": "Koden er udløbet. Bed telefonen om en ny.",
  "status.conflict.approvedByYou": "Du har allerede godkendt anmodningen, så den forbliver godkendt.",
  "status.conflict.declinedByYou": "Du har allerede afvist anmodningen, så den forbliver afvist.",
  "status.queue.one": "1 anmodning venter på dig",
  "status.queue.many": "{n} anmodninger venter på dig",
  "status.queue.done": "Du har svaret på alle anmodninger.",
  "status.answered": "Besvaret",
};
