# Phone settings and the home screen

The parent can set, and lock, a small number of phone settings from the dashboard, and choose
how Plainphone's home screen looks. Both travel in the rules document (`GET /device/rules`) and
are applied by the phone. Which Android versions support what is in
[android-versions.md](android-versions.md); the policies themselves are in [policies.md](policies.md).

## Three states per setting

| Mode | Dashboard label | What the phone does |
|---|---|---|
| `free` | The child decides (Self: "I decide") | Nothing. Plainphone does not touch the setting. Default for every setting. |
| `preset` | Set, can be changed | Plainphone sets the value once, each time the parent changes it. The child can change it afterwards. |
| `locked` | Set and locked | Plainphone sets the value and blocks the setting in Android's Settings. It is re-applied on every sync. |

Not every setting supports every mode: Android only offers some of them. A setting that cannot be
"set once" (for example Bluetooth) only has `free` and `locked`.

Why some settings have no `preset`: Android gives a Device Owner restrictions for them, not a
value it can set and then hand back. Wi-Fi and Bluetooth radios cannot be switched by an
ordinary app on Android 10+ (`WifiManager.setWifiEnabled` does nothing for apps targeting API 29+,
and `BluetoothAdapter.disable` is restricted from Android 13), mobile networks, roaming,
tethering and NFC Beam are `DISALLOW_*` switches, and camera and screen capture are
policies that are either on or off. A "set once" for these would either do nothing or be the
same as `locked`, so the dashboard does not offer it.

## Plainphone language

The per-phone language is saved independently of the lockable settings. Change
it in the web dashboard or parent app, or choose **Use phone language** to follow
Android. The legacy `language` lock setting remains in the API for older phone
builds. On strong-mode Child phones, **Lock Android language** is on by default.
Turn it off in the dashboard or parent app to allow language changes in Android
Settings after the next sync. This switch is independent of the Plainphone
language and is sent as `lockSystemLanguage` in the phone rules.

## The settings

`value` is only present for `preset` and `locked`. Settings marked "no value" are locked as they are.

| Key | Modes | Value | Android (Device Owner) |
|---|---|---|---|
| `bluetooth` | free, locked | `"off"` or `"noNewDevices"` | `off`: `DISALLOW_BLUETOOTH`. `noNewDevices`: `DISALLOW_CONFIG_BLUETOOTH` + `DISALLOW_BLUETOOTH_SHARING` (paired headphones keep working, no new pairing, no file sharing) |
| `wifi` | free, locked | no value | `DISALLOW_CONFIG_WIFI`: known networks keep working, no new ones can be added |
| `mobileNetworks` | free, locked | no value | `DISALLOW_CONFIG_MOBILE_NETWORKS`: mobile data, APN and SIM settings cannot be changed |
| `roaming` | free, locked | `"off"` | `DISALLOW_DATA_ROAMING` |
| `location` | free, preset, locked | `"on"` or `"off"` | `setLocationEnabled` (Android 11+, `LOCATION_MODE` on Android 10) + `DISALLOW_CONFIG_LOCATION` when locked. When the parent has location on for "Find", location is always on and locked, whatever this setting says. |
| `camera` | free, locked | `"off"` | `setCameraDisabled(true)` |
| `screenCapture` | free, locked | `"off"` | `setScreenCaptureDisabled(true)` |
| `screenTimeout` | free, preset, locked | seconds: 15, 30, 60, 120, 300 or 600 | `setSystemSetting(SCREEN_OFF_TIMEOUT)` + `DISALLOW_CONFIG_SCREEN_TIMEOUT` when locked |
| `brightness` | free, preset, locked | `"auto"` or a percentage 10..100 (integer) | `setSystemSetting(SCREEN_BRIGHTNESS_MODE / SCREEN_BRIGHTNESS)` + `DISALLOW_CONFIG_BRIGHTNESS` when locked |
| `volume` | free, preset, locked | preset: percentage 0..100 (integer). locked: `"muted"` | preset: `AudioManager.setStreamVolume` for ring, notifications and media. locked: `DISALLOW_ADJUST_VOLUME`, which Android implements by muting the phone. |
| `wallpaper` | free, locked | `"plainphone"` | Sets Plainphone's calm wallpaper + `DISALLOW_SET_WALLPAPER` |
| `tethering` | free, locked | `"off"` | `DISALLOW_CONFIG_TETHERING`: no hotspot or USB tethering |
| `nfc` | free, locked | `"off"` | `DISALLOW_NEAR_FIELD_COMMUNICATION_RADIO` (Android 14+); `DISALLOW_OUTGOING_BEAM` below. Note: NFC is needed for MobilePay and Google Wallet. |
| `airplaneMode` | free, locked | `"off"` | `DISALLOW_AIRPLANE_MODE`: airplane mode cannot be turned on (keeps the phone reachable and "Find" working) |

None of these work in light mode: they need Device Owner. The dashboard says so on a light-mode phone.

## Home screen

| Field | Values | Default |
|---|---|---|
| `layout` | `"list"` or `"grid"` | `"list"` |
| `theme` | `"system"`, `"light"` or `"dark"` | `"system"` |
| `palette` | `"grey"`, `"sage"` or `"sand"` | `"sage"` |
| `apps` | ordered package names on the front page, at most 8 | `[]` (the phone shows phone and messages) |
| `showFreePromise` | `true` or `false` | `true` |

Choose **Show the free promise** under Home screen in the web dashboard or under Manage in the
parent app. It controls the note on the phone in both strong and light mode. The note
uses the same wording as the [website price section](https://plainphone.org/#price).

The front page shows the clock, the date, today's school time or bedtime if one applies, the
chosen apps in the chosen order and a quiet "All apps" link. Phone and the emergency call are
always one tap away and cannot be removed. Apps that the rules hide are never shown, even if they
are on the front-page list.

## Rules document

`GET /device/rules` gets two new top-level fields. Old phones ignore them, new phones treat a missing field as the defaults.

```json
{
  "settings": {
    "camera": { "mode": "locked", "value": "off" },
    "screenTimeout": { "mode": "preset", "value": 60 },
    "wifi": { "mode": "locked" }
  },
  "home": { "layout": "list", "theme": "system", "palette": "sage", "apps": ["com.spotify.music"], "showFreePromise": true }
}
```

`settings` only lists settings that are not `free`, with keys in alphabetical order (stable ETag).

## Parent API

| Method and path | Body | Answer |
|---|---|---|
| `GET /api/phones/{pid}/settings` | | `{ "settings": { "<key>": { "mode": "free" } ... } }` with every key, `free` filled in |
| `PUT /api/phones/{pid}/settings/{key}` | `{ "mode": "locked", "value": "off" }` | 200 applied or 202 pending (same change format as the other rule endpoints) |
| `GET /api/phones/{pid}/home` | | the home object, defaults filled in |
| `PUT /api/phones/{pid}/home` | layout, theme, palette and apps | 200 applied (never waits for the key) |
| `PATCH /api/phones/{pid}/home` | `{ "showFreePromise": false }` | 200 applied (never waits for the key) |

The server rejects modes and values a setting does not support with 400.

## Self profile

Loosening a setting goes through the key (delay or trusted person), like every other loosening:

- leaving `locked` (to `preset` or `free`) loosens;
- changing the value of a `locked` setting loosens, except `bluetooth` from `noNewDevices` to `off`;
- everything else (`free` to `locked`, any `preset` change, `preset` to `free`) applies at once, since the user could change a `preset` value on the phone anyway.

Home screen changes apply immediately. They arrange allowed apps or change the display of the free promise.
