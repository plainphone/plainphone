# Google Play preparation

Everything needed to put Plainphone on Google Play that can live in the repository. Nothing has
been submitted, and no Play Console account or app entry has been created from here.

| File | What it is |
|---|---|
| [policy-review.md](policy-review.md) | Each Play policy that applies, whether Plainphone qualifies, what Google asks for, the risk, and the **recommendation per app** |
| [data-safety.md](data-safety.md) | Draft answers for the Data safety form, for both apps |
| [permission-declarations.md](permission-declarations.md) | Declaration texts for accessibility, SMS and call log, background location, VPN, foreground services; the in-app disclosures and the videos Google asks for |
| [screenshots.md](screenshots.md) | Which screens, which sizes, which existing renders can be reused, and what has to be made |
| [f-droid.md](f-droid.md) | What an F-Droid release of the phone app needs |

## Recommendation in short

- **Parent app:** Play. Start with a closed test, then open testing as the public alpha.
- **Phone app:** GitHub Releases for the alpha, as today, and F-Droid once the build is
  reproducible. A reduced Play edition (light mode, Child profile only) later, after the product
  changes in [policy-review.md](policy-review.md#what-the-phone-app-needs-before-play).
- **Strong mode:** never through Play. Check the Android Enterprise DPC allowlist now: Play
  Protect may block QR setup of an unapproved Device Owner app
  ([policy-review.md](policy-review.md#device-owner-and-qr-provisioning)).

## Store listings

Texts in en-US, da-DK, sv-SE, nb-NO and de-DE, in the layout fastlane `supply` reads:

```
fastlane/play/<locale>/                          phone app (org.plainphone.app), Play edition
parent-app/fastlane/metadata/android/<locale>/   parent app (org.plainphone.parent)
  title.txt                 30 characters at most
  short_description.txt     80 at most
  full_description.txt      4,000 at most
  changelogs/default.txt    500 at most; used for any version without its own <versionCode>.txt
```

The phone app's texts describe the Play edition only (no strong mode, no links to the APK),
because Play's monitoring rules forbid pointing to an APK outside Play. They are in
`fastlane/play/` and not in `fastlane/metadata/android/` on purpose: F-Droid reads that folder
automatically, and the F-Droid build is the full app (both modes, both profiles). See
[f-droid.md](f-droid.md#metadata).

Each full description says it is an alpha, what the parents can see, and what the app uses on the
phone (default phone and SMS app, accessibility, VPN, location, usage access; device admin is
not in the Play edition),
because the accessibility, VPN and monitoring policies require that in the listing. No text
promises safety; the brand voice is in [docs/brand/README.md](../brand/README.md#voice-and-tone).

The changelog is `default.txt` because the version code of the first Play upload is set at
release. Rename it to `<versionCode>.txt` (or add one) for later releases so old notes do not
repeat.

To upload texts without a build, once the Play app exists and a service account is set up:

```sh
fastlane supply --package_name org.plainphone.app --metadata_path fastlane/play \
  --skip_upload_apk --skip_upload_aab --skip_upload_images --skip_upload_screenshots
fastlane supply --package_name org.plainphone.parent --metadata_path parent-app/fastlane/metadata/android \
  --skip_upload_apk --skip_upload_aab --skip_upload_images --skip_upload_screenshots
```

## Submitting the parent app (Play Console steps)

For whoever owns the developer account. The phone app follows the same steps after the changes in
[policy-review.md](policy-review.md#what-the-phone-app-needs-before-play), plus the declarations in
[permission-declarations.md](permission-declarations.md).

1. **Account:** create or use an *organisation* developer account for the company that runs the
   hosted service, and complete the organisation verification (D-U-N-S). Personal accounts must run
   a 14-day closed test with 12 testers first.
2. **Create app:** Play Console → Create app → name "Plainphone for parents", default language
   English (United States), App, Free. Accept the declarations.
3. **App signing:** Setup → App signing. For the phone app choose to upload the existing production
   key, so Play, GitHub and F-Droid builds share one signature. For the parent app Google's key is
   fine, but then set `ANDROID_APP_CERT_SHA256` on the server to Play's app signing certificate so
   app links verify ([parent-app.md](../parent-app.md)).
4. **Store listing:** Grow users → Store presence → Main store listing. Paste the texts from
   `parent-app/fastlane/metadata/android/en-US/` and add the four other languages as translations.
   Category: Parenting. Contact email and website `https://plainphone.org/`. Upload the icon,
   feature graphic and 2 to 8 screenshots per [screenshots.md](screenshots.md).
5. **App content** (Policy → App content):
   - Privacy policy: `https://plainphone.org/privacy/`.
   - Ads: no ads.
   - App access: "All or some functionality is restricted", with the review sign-in: username
     `REVIEW_LOGIN_EMAIL`, password `REVIEW_LOGIN_CODE` and the note in
     [store-review.md](../store-review.md#google-play-console-app-access).
   - Content rating: fill in the IARC questionnaire (no violence, no user-to-user chat with
     strangers; messages only with people the parents added).
   - Target audience: 18 and over. Not designed for children.
   - Data safety: from [data-safety.md](data-safety.md), parent app section.
   - Data deletion: in-app path Settings → Delete my account, and the web link
     `https://plainphone.org/delete-account/`.
   - Government app: no. Financial features: none. Health: none. News: no.
6. **Testing:** Testing → Closed testing → create a track, upload the AAB built from
   `parent-app` by the maintainer (automated jobs do not run `eas build`), add testers by email list, and fill in
   the release notes from `changelogs/default.txt`.
7. **Review:** send for review from Publishing overview. Keep answers and the listing in step with
   this folder when anything changes.
8. **Open testing:** when the closed test is fine, promote the release to Open testing; that is the
   public alpha.
