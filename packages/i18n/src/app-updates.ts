// SPDX-License-Identifier: Apache-2.0
//
// App updates in strong mode (docs/policies.md, "App updates"), shared by the dashboard and the
// parent app. Kept in its own file so the main catalogues only spread it in. Never use em dashes in copy.

export const appUpdatesEn = {
  "appUpdates.title": "App updates",
  "appUpdates.switch": "Update approved apps automatically",
  "appUpdates.help": "Once a night, while the phone charges on Wi-Fi, Play may update approved apps for up to 45 minutes. New apps stay hidden until you approve them.",
  "appUpdates.now": "Update apps now",
  "appUpdates.requested": "The phone opens the update window the next time it is online.",
  "appUpdates.none": "No update window yet.",
  "appUpdates.open": "Updating apps since {time}.",
  "appUpdates.last": "Last update window: {from} to {to}. Apps updated: {count}.",
  "appUpdates.caught": "New apps kept hidden: {count}. Each one was sent to you as a request.",
  "appUpdates.failedBattery": "The update window could not open. On the phone, let Plainphone run without battery limits.",
  "appUpdates.failed": "The update window could not open. Try again later.",
  "appUpdates.receipt": "Apps may update until {time}. New apps stay hidden.",
};

export const appUpdatesDa: Record<keyof typeof appUpdatesEn, string> = {
  "appUpdates.title": "Opdatering af apps",
  "appUpdates.switch": "Opdatér godkendte apps automatisk",
  "appUpdates.help": "En gang hver nat, mens telefonen lader på wifi, må Play opdatere godkendte apps i op til 45 minutter. Nye apps forbliver skjulte, indtil du godkender dem.",
  "appUpdates.now": "Opdatér apps nu",
  "appUpdates.requested": "Telefonen åbner for opdateringer, næste gang den er online.",
  "appUpdates.none": "Ingen opdateringer endnu.",
  "appUpdates.open": "Opdaterer apps siden {time}.",
  "appUpdates.last": "Seneste opdatering: {from} til {to}. Opdaterede apps: {count}.",
  "appUpdates.caught": "Nye apps holdt skjult: {count}. Hver af dem er sendt til dig som en anmodning.",
  "appUpdates.failedBattery": "Opdateringen kunne ikke starte. Lad Plainphone køre uden batteribegrænsning på telefonen.",
  "appUpdates.failed": "Opdateringen kunne ikke starte. Prøv igen senere.",
  "appUpdates.receipt": "Apps kan blive opdateret indtil {time}. Nye apps forbliver skjulte.",
};

export const appUpdatesSv: Record<keyof typeof appUpdatesEn, string> = {
  "appUpdates.title": "Appuppdateringar",
  "appUpdates.switch": "Uppdatera godkända appar automatiskt",
  "appUpdates.help": "En gång per natt, när telefonen laddar på wifi, får Play uppdatera godkända appar i upp till 45 minuter. Nya appar förblir dolda tills du godkänner dem.",
  "appUpdates.now": "Uppdatera appar nu",
  "appUpdates.requested": "Telefonen öppnar för uppdateringar nästa gång den är online.",
  "appUpdates.none": "Inga uppdateringar ännu.",
  "appUpdates.open": "Uppdaterar appar sedan {time}.",
  "appUpdates.last": "Senaste uppdatering: {from} till {to}. Uppdaterade appar: {count}.",
  "appUpdates.caught": "Nya appar som hålls dolda: {count}. Var och en har skickats till dig som en förfrågan.",
  "appUpdates.failedBattery": "Uppdateringen kunde inte starta. Låt Plainphone köras utan batteribegränsning på telefonen.",
  "appUpdates.failed": "Uppdateringen kunde inte starta. Försök igen senare.",
  "appUpdates.receipt": "Appar kan uppdateras till {time}. Nya appar förblir dolda.",
};

export const appUpdatesNb: Record<keyof typeof appUpdatesEn, string> = {
  "appUpdates.title": "Appoppdateringer",
  "appUpdates.switch": "Oppdater godkjente apper automatisk",
  "appUpdates.help": "Én gang hver natt, mens telefonen lader på wifi, kan Play oppdatere godkjente apper i opptil 45 minutter. Nye apper forblir skjult til du godkjenner dem.",
  "appUpdates.now": "Oppdater apper nå",
  "appUpdates.requested": "Telefonen åpner for oppdateringer neste gang den er på nett.",
  "appUpdates.none": "Ingen oppdateringer ennå.",
  "appUpdates.open": "Oppdaterer apper siden {time}.",
  "appUpdates.last": "Siste oppdatering: {from} til {to}. Oppdaterte apper: {count}.",
  "appUpdates.caught": "Nye apper holdt skjult: {count}. Hver av dem er sendt til deg som en forespørsel.",
  "appUpdates.failedBattery": "Oppdateringen kunne ikke starte. La Plainphone kjøre uten batteribegrensning på telefonen.",
  "appUpdates.failed": "Oppdateringen kunne ikke starte. Prøv igjen senere.",
  "appUpdates.receipt": "Apper kan oppdateres til {time}. Nye apper forblir skjult.",
};

export const appUpdatesDe: Record<keyof typeof appUpdatesEn, string> = {
  "appUpdates.title": "App-Updates",
  "appUpdates.switch": "Genehmigte Apps automatisch aktualisieren",
  "appUpdates.help": "Einmal pro Nacht, während das Telefon im WLAN lädt, darf Play genehmigte Apps bis zu 45 Minuten lang aktualisieren. Neue Apps bleiben versteckt, bis du sie genehmigst.",
  "appUpdates.now": "Apps jetzt aktualisieren",
  "appUpdates.requested": "Das Telefon öffnet das Update-Fenster, sobald es wieder online ist.",
  "appUpdates.none": "Noch keine Updates.",
  "appUpdates.open": "Apps werden seit {time} aktualisiert.",
  "appUpdates.last": "Letztes Update-Fenster: {from} bis {to}. Aktualisierte Apps: {count}.",
  "appUpdates.caught": "Neue Apps, die versteckt bleiben: {count}. Jede wurde dir als Anfrage geschickt.",
  "appUpdates.failedBattery": "Das Update-Fenster konnte nicht öffnen. Erlaube Plainphone auf dem Telefon, ohne Akku-Beschränkung zu laufen.",
  "appUpdates.failed": "Das Update-Fenster konnte nicht öffnen. Versuche es später noch einmal.",
  "appUpdates.receipt": "Apps können bis {time} aktualisiert werden. Neue Apps bleiben versteckt.",
};
