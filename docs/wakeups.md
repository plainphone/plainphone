# Android wakeups and scheduling

These call sites cover alarms, WorkManager scheduling, receiver and network registrations, delayed handlers, wake locks, and location requests in the app source.
A receiver or a handler does not itself wake a sleeping CPU. WorkManager timing depends on constraints and
Android power management. Android can defer inexact alarms and throttle alarms allowed while idle.

Paths are relative to `android/app/src/main/java/org/plainphone/app`. The unit test checks the call sites
in this table against the production source, including both branches of platform fallbacks.

| Call site | Interval or trigger | Screen | Reason |
| --- | --- | --- | --- |
| `PlainphoneApplication.kt` `registerReceiver(` | On screen-on | On | Reapply the lock and enqueue immediate rules sync. |
| `PlainphoneApplication.kt` `registerReceiver(` | On screen-off | Off | Arm the idle safety poll. |
| `PlainphoneApplication.kt` `registerReceiver(` | On package add, remove or change | Either | Invalidate the inventory. A new installation also reconciles its install window and requests sync. |
| `PlainphoneApplication.kt` `registerReceiver(` | On locale change | Either | Invalidate localized app labels. |
| `PlainphoneApplication.kt` `getSystemService(ConnectivityManager::class.java)?.registerDefaultNetworkCallback(` | When the default network becomes available | Either | Request sync, throttled to once a minute. |
| `RoleWatcher.kt` `context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)` | On default-role changes | Either | Recheck phone and SMS roles (Android 13+). |
| `RoleWatcher.kt` `context.registerReceiver(receiver, filter)` | On default-role changes | Either | Recheck phone and SMS roles (older Android). |
| `Lock.kt` `am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.toEpochMilli() + 1_000L, windowIntent(context))` | Next rule-window boundary + 1 s | Either | Apply school time and bedtime transitions. |
| `Lock.kt` `context.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(` | At maintenance expiry | Either | Restore the lock after a parent unlocks it. |
| `MaintenanceActivity.kt` `handler.postDelayed(this, remaining)` | At the install-window deadline | On | Update the maintenance UI when an install window closes. |
| `light/GuardService.kt` `main.postDelayed(this, TICK_MS)` | 30 s | On | Recheck the foreground app’s time limit. |
| `light/GuardService.kt` `if (intent.action == Intent.ACTION_SCREEN_ON && isInteractive()) main.postDelayed(tick, TICK_MS)` | On screen-on, first tick in 30 s | On | Resume foreground time checks. |
| `light/GuardService.kt` `registerReceiver(it, IntentFilter().apply { addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_SCREEN_OFF) })` | On screen-on or screen-off | Either | Start or stop foreground time checks. |
| `light/GuardService.kt` `if (isInteractive()) main.postDelayed(tick, TICK_MS)` | On connection, first tick in 30 s | On | Start foreground time checks when already interactive. |
| `light/GuardService.kt` `VPN_RETRY_DELAYS_MS.forEach { main.postDelayed(vpnRetry, it) }` | 50, 150, 300, 600 and 1,000 ms | On | Retry dismissing the VPN settings dialog. |
| `light/GuardService.kt` `if (!main.hasCallbacks(settingsCheck)) main.postDelayed(settingsCheck, SETTINGS_MAX_WAIT_MS)` | 150 ms maximum wait | On | Bound how long settings enforcement waits to examine a window. |
| `safety/RingService.kt` `main.postDelayed(timeout, (endsAt - now).coerceAtLeast(1_000L))` | At ring expiry | Either | Stop the audible ring. |
| `safety/Safety.kt` `if (exact) am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, elapsed, pi)` | 2 min idle poll or check-in deadline + 2 s | Either | Wake for a safety request or deadline using an exact alarm where available. |
| `safety/Safety.kt` `else am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, elapsed, pi)` | 2 min idle poll or check-in deadline + 2 s | Either | Use an inexact alarm when exact alarms are unavailable. |
| `safety/Safety.kt` `am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, elapsed, pi)` | 2 min idle poll or check-in deadline + 2 s | Either | Use an inexact alarm if exact alarm permission changes. |
| `sync/AndroidSync.kt` `val sticky = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))` | Once per status read | Either | Read the sticky battery state without subscribing. |
| `sync/AndroidSync.kt` `val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)` | 15 min | Either | Build the connected-network periodic sync. |
| `sos/SosScreen.kt` `id = SosDelivery.enqueue(context, phoneId, kind)` | After a child confirms SOS | On | Start the report when the undo window expires. |
| `sos/SosDelivery.kt` `val request = OneTimeWorkRequestBuilder<SosWorker>()` | Once per confirmed SOS | On | Build the durable report request. |
| `sos/SosDelivery.kt` `WorkManager.getInstance(context).enqueueUniqueWork(id, ExistingWorkPolicy.KEEP, request)` | On SOS and WorkManager retries | Either | Keep the report under one identifier until online delivery succeeds or the event expires. |
| `sos/SilentSos.kt` `return runCatching { SosDelivery.enqueue(context, phoneId, SosKind.URGENT, trigger, message) }` | On a hidden SOS (power button, clock) or a code word | Either | Start a silent urgent report. |
| `sos/SilentSos.kt` `app.registerReceiver(` | On screen-on or screen-off | Either | Count power button presses for the hidden SOS; does nothing unless the parents switched it on. |
| `sos/QuickMessageDelivery.kt` `val request = OneTimeWorkRequestBuilder<QuickMessageWorker>()` | Once per quick message tap | On | Build the quick message delivery request. |
| `sos/QuickMessageDelivery.kt` `WorkManager.getInstance(context).enqueueUniqueWork("quick-$id", ExistingWorkPolicy.KEEP, request)` | On a tap and WorkManager retries, at most 30 min | Either | Deliver the quick message online, or by SMS as the fallback. |
| `sync/AndroidSync.kt` `WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)` | 15 min | Either | Enqueue one unique periodic sync. |
| `sync/AndroidSync.kt` `val request = OneTimeWorkRequestBuilder<LocalSetupUndoWorker>().build()` | After an incomplete local release or on startup with an undo pending | Either | Build the local retry without a network requirement. |
| `sync/AndroidSync.kt` `WorkManager.getInstance(context).enqueueUniqueWork(LOCAL_UNDO, ExistingWorkPolicy.KEEP, request)` | After an incomplete local release or on startup with an undo pending | Either | Coalesce local release retries. Once complete, enqueue the separate network report. |
| `sync/AndroidSync.kt` `WorkManager.getInstance(context).enqueueUniqueWork(workName, policy, request)` | On demand | Either | Coalesce ordinary immediate sync triggers with KEEP. Append pushes and transport changes with APPEND_OR_REPLACE. Use a separate work name to report a local setup undo even while an ordinary sync is already running. This report keeps retrying with backoff until acknowledged. |
| `sync/AndroidSync.kt` `WorkManager.getInstance(context).enqueueUniqueWork(SOON, ExistingWorkPolicy.REPLACE, request)` | Normally 60 s; 10 s during an active safety request | Normally on; either during active safety requests | Schedule the next sync with the server-provided interval. |
| `sync/AndroidSync.kt` `WorkManager.getInstance(context).enqueueUniqueWork(ENROLL, ExistingWorkPolicy.KEEP, request)` | On provisioning or boot if enrollment is pending | Either | Redeem the enrollment token with backoff. |
| `sync/AndroidSync.kt` `val request = OneTimeWorkRequestBuilder<SyncWorker>()` | On demand | Either | Build the coalesced immediate sync. |
| `sync/AndroidSync.kt` `val request = OneTimeWorkRequestBuilder<SyncWorker>()` | At the next poll | Normally on; either during active safety requests | Build the follow-up sync. |
| `sync/AndroidSync.kt` `val request = OneTimeWorkRequestBuilder<EnrollWorker>()` | On provisioning or boot | Either | Build the pending enrollment work. |
| `sync/AndroidSync.kt` `lm.getCurrentLocation(provider, request, cancel, DIRECT_EXECUTOR) { done(it) }` | On a regular location lookup | Either | Request a one-shot fix on Android 12+. |
| `sync/AndroidSync.kt` `lm.getCurrentLocation(provider, cancel, DIRECT_EXECUTOR) { done(it) }` | On a location lookup | Either | Request a one-shot fix on Android 11+. |
| `sync/AndroidSync.kt` `lm.requestLocationUpdates(provider, request, DIRECT_EXECUTOR, listener)` | On a precise location lookup | Either | Listen for a fresh fix with a bounded request. |
| `sync/AndroidSync.kt` `lm.requestLocationUpdates(provider, 0L, 0f, listener, thread.looper)` | On a precise location lookup on older Android | Either | Listen until a fresh fix arrives or the lookup ends. |
| `sync/AndroidSync.kt` `lm.requestSingleUpdate(provider, listener, thread.looper)` | On a single location lookup on older Android | Either | Request a one-shot fix. |
| `time/TimeTicker.kt` `main.postDelayed(this, EVERY_MS)` | 60 s | On | Recheck time limits in strong mode. |
| `time/TimeTicker.kt` `context.registerReceiver(` | On screen-on or screen-off | Either | Start or stop the time-limit ticker. |
| `time/TimeTicker.kt` `if (intent.action == Intent.ACTION_SCREEN_ON) main.postDelayed(tick, EVERY_MS)` | On screen-on, first tick in 60 s | On | Resume time-limit checks. |
| `time/TimeTicker.kt` `main.postDelayed(tick, EVERY_MS)` | On registration, first tick in 60 s | On | Start time-limit checks if the screen is already interactive. |
| `update/AppUpdateWorker.kt` `val request = PeriodicWorkRequestBuilder<AppUpdateWorker>(30, TimeUnit.MINUTES)` | 30 min, only while charging on an unmetered network | Either | Build the nightly app update check (docs/policies.md, "App updates"); it exits at once outside 02:00 to 05:00. |
| `update/AppUpdateWorker.kt` `.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)` | 30 min, only while charging on an unmetered network | Either | Enqueue one unique nightly app update check. |
| `update/AppUpdateWorker.kt` `val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))` | Once per nightly check | Either | Read the sticky battery state without subscribing. |
| `update/InstallRecoveryWorker.kt` `val request = OneTimeWorkRequestBuilder<InstallRecoveryWorker>()` | At install-lease expiry | Either | Build the recovery backup with a delay. |
| `update/InstallRecoveryWorker.kt` `WorkManager.getInstance(context).enqueue(request).result.get(5, TimeUnit.SECONDS)` | At install-lease expiry | Either | Persist the recovery backup before lifting the restriction. |
| `update/InstallWatchdogService.kt` `.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Plainphone:install-watchdog")` | When the watchdog starts | Either | Create the partial wake lock used for install recovery. |
| `update/InstallWatchdogService.kt` `wakeLock.acquire(InstallLease.LONGEST_MS + 5_000L)` | When a lease is armed | Either | Keep the CPU available until recovery, bounded by the longest lease (45 min app update window). |
| `update/InstallWatchdogService.kt` `check(timer.postDelayed({ onDeadline(ticket.deadline) }, remaining))` | At install-lease expiry | Either | Restore the install restriction before releasing the watchdog’s bounded wake lock. |
| `update/InstallWatchdogService.kt` `timer.postDelayed({ onDeadline(deadline, force) }, remaining)` | At the remaining lease deadline | Either | Re-arm a watchdog callback that arrived early. |
| `update/InstallWatchdogService.kt` `timer.postDelayed({ onDeadline(deadline, force) }, 1_000L)` | 1 s after a recovery error | Either | Retry restoring the install restriction. |
| `update/UpdateRequestListener.kt` `app.registerReceiver(object : BroadcastReceiver() {` | On screen-on, screen-off or user-present | Either | Start or stop the interactive update long poll. |
| `update/UpdateWorker.kt` `val request = PeriodicWorkRequestBuilder<UpdateWorker>(6, TimeUnit.HOURS)` | 6 h, with 10 min initial delay | Either | Build the periodic update request used by both constraint paths. |
| `update/UpdateWorker.kt` `WorkManager.getInstance(context).enqueueUniquePeriodicWork(name, ExistingPeriodicWorkPolicy.UPDATE, request)` | 6 h per variant | Either | Enqueue the unmetered and connected-plus-charging checks; they share a daily gate. |
| `update/UpdateWorker.kt` `val request = OneTimeWorkRequestBuilder<UpdateWorker>()` | Once per parent request | Either | Build the force-update check. |
| `update/UpdateWorker.kt` `WorkManager.getInstance(context).enqueueUniqueWork("$NOW-$requestedAtMs", ExistingWorkPolicy.KEEP, request)` | Once per parent request | Either | Queue the force-update check under its request timestamp. |
| `update/UpdateReceiver.kt` `alarms.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, atMs, intent)` | At install-lease expiry | Either | Restore the install restriction via an exact alarm where available. |
| `update/UpdateReceiver.kt` `alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, atMs, intent)` | At install-lease expiry | Either | Restore the install restriction via the inexact fallback. |

The manifest also registers system broadcasts, including boot and app replacement. A default-network
callback can request immediate sync when connectivity returns. See [phone sync](phone-sync.md),
[safety polling](location.md), and [self-updates](android-updates.md) for those triggers and their constraints.

## Remote sync wakeups

With **Faster rule updates** enabled for a phone, an FCM data message or UnifiedPush broadcast can enqueue a normal WorkManager sync. The phone checks the reason and its cached rules before scheduling work. This path adds no alarm or continuous service in Plainphone. UnifiedPush's distributor maintains its own delivery connection.

The phone prefers FCM when the server validates its token, then a compatible UnifiedPush distributor, then its existing polling. **Wakeups without Google** selects UnifiedPush and polling for that phone. Token and distributor changes trigger a registration check. The phone also retries every 15 minutes while wakeups are enabled. WorkManager queues a follow-up sync when a push arrives during a sync, so rules fetched by the earlier job can be refreshed. Firebase can delay or deprioritize high-priority data messages that consistently produce no user-visible notifications. The periodic schedule and interactive long poll still provide delivery opportunities. See [Firebase's delivery behavior](https://firebase.google.com/docs/cloud-messaging/android-message-priority) and [the sync contract](sync-api.md#push-wakeups).
