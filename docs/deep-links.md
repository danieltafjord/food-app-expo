# Invitation deep links

Invitation emails link to `https://handlelistaapp.no/invitations/<token>`. For
those links to open the app instead of the website, they're registered as
platform-verified links.

The **app side** is configured in `app.json` (`ios.associatedDomains` +
`android.intentFilters`, scoped to the `/invitations` path). The two files below
must be served by the **backend** over HTTPS for verification to succeed — without
them the links fall back to opening in the browser.

expo-router maps the `/invitations/<token>` URL path to
`src/app/invitations/[token].tsx` automatically, so no extra linking config is
needed. The `foodapp://invitations/<token>` custom-scheme link keeps working
regardless of any of this.

## iOS — Apple App Site Association

Serve at `https://handlelistaapp.no/.well-known/apple-app-site-association`
with `Content-Type: application/json`, no redirect, and **no** `.json` extension:

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "<APPLE_TEAM_ID>.no.handlelistaapp",
        "paths": ["/invitations/*"]
      }
    ]
  }
}
```

`<APPLE_TEAM_ID>` is your Apple Developer Team ID (Membership page, or
`eas credentials`).

## Android — Digital Asset Links

Serve at `https://handlelistaapp.no/.well-known/assetlinks.json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "no.handlelistaapp",
      "sha256_cert_fingerprints": ["<SHA256_FINGERPRINT>"]
    }
  }
]
```

`<SHA256_FINGERPRINT>` is the release signing cert's SHA-256 fingerprint. For
EAS-managed signing, get it with `eas credentials` (Android → production keystore).

## If you also use `www.handlelistaapp.no`

Add `applinks:www.handlelistaapp.no` to `ios.associatedDomains`, add a second
`host` entry to the Android intent filter, and serve the same two files there.
