# SynoraCare Mobile App

Expo React Native app for SynoraCare.

## Run locally

```bash
cd mobile-app
npm install
npm run ios
# or
npm run android
# or
npm run web
```

## What it does

- Shows SynoraCare branded launch screen
- Checks backend health (`/health`)
- Opens live production console inside an in-app WebView

## Production endpoints in app

- Web: `https://www.synoracare.com`
- API health: `https://synoracare-backend.onrender.com/health`

## Publish to Apple App Store

1. Install EAS CLI and sign in.

```bash
npm install -g eas-cli
cd mobile-app
eas login
```

2. Initialize Expo/EAS project once.

```bash
eas init
```

3. Fill App Store values in `eas.json`.

- `submit.production.ios.ascAppId`
- `submit.production.ios.appleTeamId`

4. Build iOS production binary.

```bash
npm run build:ios
```

5. Submit to App Store Connect.

```bash
npm run submit:ios
```

6. In App Store Connect, complete listing fields and submit for review.

## Required Apple-side setup

- Active Apple Developer Program membership
- App ID using bundle identifier `com.synoracare.ai`
- App Store Connect app record created for SynoraCare
- Privacy Policy URL and support URL ready
- App screenshots for iPhone sizes and app icon 1024x1024
