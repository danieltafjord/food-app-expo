# Handlelista (food-app-expo)

Offline-first meal planner and shopping list for households. Plan dinners for
the week, keep recipes with ingredients, and generate an aisle-grouped shopping
list — all on-device with no account. Optionally connect a cloud account to
share and sync a household across devices.

The backend is the Laravel app in `../food-app` (Passport OAuth, REST + a
batched `/api/v1/sync` endpoint).

## Stack

- Expo SDK 56 · React Native 0.85 · React 19 (React Compiler on) · expo-router
  with native tabs · TypeScript
- Local store: Legend-State v3 persisted to expo-sqlite (`src/lib/store/`)
- Cloud sync engine: `src/lib/sync/` · Auth: OAuth2 PKCE via `expo-auth-session`
- Tests: jest (`npm test`), pure-logic tests under `src/**/*.test.ts`

## Requirements

- A **development build** — the app uses native modules (native tabs, SecureStore,
  SQLite, haptics) that Expo Go does not ship.
- Xcode 26 / CocoaPods for iOS. `patches/` carries Swift 6.2 fixes for
  `expo-modules-core` / `expo-modules-jsi` that `patch-package` applies on
  `npm install`; keep them until Expo ships a compatible release.
- Node 22+.

## Run locally

1. Backend: `food-app` served by Laravel Herd at `http://food-app.test`
   (migrated, with a public Passport client — see below). Invitation e-mails go
   through the queue: `php artisan queue:work` in `../food-app`.
2. Copy `.env.example` to `.env` and fill in `EXPO_PUBLIC_OAUTH_CLIENT_ID`.
3. Build and install the native app (the locale exports are required, or
   CocoaPods aborts with an encoding error in a non-interactive shell):

   ```bash
   npm install
   export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
   npx expo run:ios --device "iPhone 17 Pro"
   ```

4. Start Metro and open the app: `npx expo start --dev-client`, then press `i`.

The app boots straight into the Plans tab. "Connect cloud account" lives under
the Account tab.

## Environment variables

| Variable                       | Purpose                                                             |
| ------------------------------ | ------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL`          | Backend origin. Dev default `http://food-app.test`; required in release builds. |
| `EXPO_PUBLIC_OAUTH_CLIENT_ID`  | Public Passport client id. Empty or `REPLACE_WITH_…` hides sign-in. |

Create the Passport client once per backend environment:

```bash
php artisan passport:client --public \
  --name="Food App Mobile" \
  --redirect_uri="foodapp://oauth/callback"
```

Per-profile values for EAS builds live in `eas.json`; replace the
`REPLACE_WITH_*` placeholders (or use EAS secrets) before building `preview` /
`production`. The iOS ATS exception for `food-app.test` is added by
`app.config.ts` for every profile except `production`.

## Checks

```bash
npx tsc --noEmit
npx expo lint
npm test
```

## Gotchas

- iOS Simulator builds without an Apple team can't use the Keychain; the session
  then lives in memory only (lost on a full relaunch, kept across Fast Refresh).
- Physical devices need your machine's LAN IP (or a tunnel) in
  `EXPO_PUBLIC_API_URL`, not `food-app.test`.
- Deep links for invitations: see `docs/deep-links.md`.
