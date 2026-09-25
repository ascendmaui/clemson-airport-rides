# Google Sign-In Setup Guide

This guide details the exact steps required to enable and activate Google Sign-In for Clemson RIDES across native iOS/Android apps and the web platform.

Native apps and UI components already contain readiness gating (`packages/rides-native/googleAuthConfig.js`). The Google button automatically remains disabled with the friendly copy *"Google sign-in is coming soon"* until the required public client IDs are configured. Once the steps below are completed, Google Sign-In activates without any code changes.

---

## Architecture & Project Summary

- **Supabase Project:** `awktabuhijrshmsmagpq`
  - URL: `https://awktabuhijrshmsmagpq.supabase.co`
  - OAuth Callback: `https://awktabuhijrshmsmagpq.supabase.co/auth/v1/callback`
- **Web App / Production Domain:**
  - Site URL: `https://clemson-rides.vercel.app`
- **Rider Native App:**
  - Bundle Identifier / Package Name: `com.ascendmaui.clemsonrides.rider`
  - URL Scheme: `clemsonrides`
  - Deep Link Callback: `clemsonrides://auth/callback`
  - EAS Project ID: `d02319c9-69ef-4523-a0a5-6712c037d5fa`
- **Driver Native App:**
  - Bundle Identifier / Package Name: `com.ascendmaui.clemsonrides.driver`
  - URL Scheme: `clemsonrides-driver`
  - Deep Link Callback: `clemsonrides-driver://auth/callback`
  - EAS Project ID: `090d10b8-2f52-4502-ac9d-e8bd0fe35033`
- **Apple Team ID:** `L85AF3V872` (Ascend Maui LLC)

---

## Step 1: Google Cloud Console Setup

1. Open the [Google Cloud Console Credentials Page](https://console.cloud.google.com/apis/credentials).
2. Select or create the project for Clemson RIDES (e.g. `ascendmaui` or `clemson-rides`).

### 1.1 Configure OAuth Consent Screen
1. Navigate to **APIs & Services** → **OAuth consent screen**.
2. Select **External** user type and click **Create**.
3. Fill in the App Information:
   - **App name:** `Clemson RIDES`
   - **User support email:** `johnmatveyev@gmail.com` (or `jmat2019@icloud.com`)
   - **App domain:**
     - Application home page: `https://clemson-rides.vercel.app`
     - Application privacy policy link: `https://clemson-rides.vercel.app`
   - **Developer contact information:** `johnmatveyev@gmail.com`
4. Under **Scopes**, click **Add or Remove Scopes** and select:
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `openid`
5. Save and continue. Move the publishing status to **Production** (or add test users if verifying in Testing mode).

### 1.2 Create Web Application Client (Required by Supabase)
Supabase Auth executes the OAuth 2.0 authorization code exchange using Google's Web OAuth credentials.

1. Navigate to **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**.
2. Select Application type: **Web application**.
3. Name: `Clemson RIDES Web & Supabase Backend`.
4. **Authorized JavaScript origins**:
   - `https://clemson-rides.vercel.app`
   - `https://awktabuhijrshmsmagpq.supabase.co`
   - `http://localhost:5173` *(for local web development)*
   - `http://localhost:8081` *(for Expo web development)*
5. **Authorized redirect URIs**:
   - `https://awktabuhijrshmsmagpq.supabase.co/auth/v1/callback` *(CRITICAL: Supabase Auth OAuth callback)*
   - `https://clemson-rides.vercel.app`
6. Click **Create**.
7. Copy and securely save:
   - **Web Client ID** (e.g. `[CLIENT_ID].apps.googleusercontent.com`)
   - **Web Client Secret**

### 1.3 Create iOS Client IDs
Google requires an iOS OAuth client matching each app's bundle identifier for native authentication.

1. Click **Create Credentials** → **OAuth client ID**.
2. Select Application type: **iOS**.
3. For Rider:
   - Name: `Clemson RIDES Rider iOS`
   - Bundle ID: `com.ascendmaui.clemsonrides.rider`
   - Team ID: `L85AF3V872`
4. Click **Create** and record the **Rider iOS Client ID**.
5. Repeat for Driver:
   - Click **Create Credentials** → **OAuth client ID**.
   - Application type: **iOS**.
   - Name: `Clemson RIDES Driver iOS`
   - Bundle ID: `com.ascendmaui.clemsonrides.driver`
   - Team ID: `L85AF3V872`
6. Click **Create** and record the **Driver iOS Client ID**.

*(Note: Both client IDs can also share the primary iOS Client ID in EAS if bundle IDs are registered under the same developer team, but separate clients ensure strict bundle verification).*

### 1.4 Create Android Client IDs (Optional / Preparation for Android)
1. Click **Create Credentials** → **OAuth client ID**.
2. Select Application type: **Android**.
3. Package Name: `com.ascendmaui.clemsonrides.rider` (and `com.ascendmaui.clemsonrides.driver`).
4. SHA-1 certificate fingerprint: Obtain from EAS credentials (`eas credentials -p android`) or your release keystore.
5. Click **Create** and record the **Android Client ID**.

---

## Step 2: Supabase Auth Configuration

1. Log into the [Supabase Dashboard](https://supabase.com/dashboard/project/awktabuhijrshmsmagpq).
2. Go to **Authentication** → **Providers** → **Google**.
3. Switch **Enable Google provider** to **ON**.
4. In **Client ID (for OAuth)**: Paste the **Web Client ID** from Step 1.2.
5. In **Client Secret (for OAuth)**: Paste the **Web Client Secret** from Step 1.2.
6. *(Optional)* In **Authorized Client IDs**: Add the iOS Client IDs from Step 1.3 comma-separated.
7. Click **Save**.

### 2.1 Supabase Redirect Allowlist
1. Go to **Authentication** → **URL Configuration**.
2. **Site URL:** Ensure it is set to `https://clemson-rides.vercel.app`.
3. **Redirect URLs (Allowlist):** Ensure the following URIs are present:
   - `https://clemson-rides.vercel.app/**`
   - `https://clemson-rides.vercel.app`
   - `clemsonrides://**` *(matches `clemsonrides://auth/callback`)*
   - `clemsonrides-driver://**` *(matches `clemsonrides-driver://auth/callback`)*
   - `http://localhost:5173/**` *(local Vite web)*
   - `exp://**` *(Expo Go / development builds)*
4. Click **Save**.

---

## Step 3: Environment Variables — Where to Set What

| Variable Name | Value / Source | Where to Set | Visibility |
| :--- | :--- | :--- | :--- |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Web Client ID from Step 1.2 | EAS Environment Variables (Rider & Driver projects), local `.env` | Public (baked into app binary) |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | iOS Client ID from Step 1.3 | EAS Environment Variables (Rider & Driver projects), local `.env` | Public (baked into app binary) |
| `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` | Android Client ID from Step 1.4 *(optional)* | EAS Environment Variables (Android profile), local `.env` | Public (baked into app binary) |
| **Google Client Secret** | Web Client Secret from Step 1.2 | **Supabase Dashboard ONLY** | **SECRET** — Never commit or expose |

> [!CAUTION]
> **Never commit or expose the Google Client Secret.** The client secret must ONLY be entered in the Supabase Dashboard. Public Expo apps and EAS build profiles only need the public Client IDs (`EXPO_PUBLIC_*`).

### Setting Variables in EAS for Production & Preview Builds

Using the EAS CLI:

```bash
# In apps/rider (EAS project d02319c9-69ef-4523-a0a5-6712c037d5fa)
cd apps/rider
eas env:create --scope project --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value "<YOUR_WEB_CLIENT_ID>" --type string
eas env:create --scope project --name EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID --value "<YOUR_RIDER_IOS_CLIENT_ID>" --type string

# In apps/driver (EAS project 090d10b8-2f52-4502-ac9d-e8bd0fe35033)
cd ../driver
eas env:create --scope project --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value "<YOUR_WEB_CLIENT_ID>" --type string
eas env:create --scope project --name EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID --value "<YOUR_DRIVER_IOS_CLIENT_ID>" --type string
```

Or configure directly in the Expo EAS Dashboard:
- Project `clemson-rides-rider` → **Environment variables** → Add `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
- Project `clemson-rides-driver` → **Environment variables** → Add `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.

### Setting Variables for Local Testing

In `apps/rider/.env` (or `apps/rider/.env.local`):
```bash
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<YOUR_WEB_CLIENT_ID>
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<YOUR_RIDER_IOS_CLIENT_ID>
```

In `apps/driver/.env` (or `apps/driver/.env.local`):
```bash
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<YOUR_WEB_CLIENT_ID>
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<YOUR_DRIVER_IOS_CLIENT_ID>
```

*(No Vercel environment variable changes are needed because the web client uses Supabase Auth's hosted OAuth flow directly).*

---

## Step 4: Verification & Smoke Test

1. **Verify Readiness State When Unset:**
   - Run the app without client ID env variables.
   - The "Continue with Google" button is displayed in a disabled state with hint copy *"Google sign-in is coming soon"*.
   - Tapping it does not fail or throw unhandled exceptions.

2. **Verify Activation When Configured:**
   - Supply valid `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
   - The button becomes active.
   - Tapping "Continue with Google" opens an in-app browser (`WebBrowser.openAuthSessionAsync`) to Google sign-in.
   - Upon selecting a Google account, Google redirects to Supabase (`https://awktabuhijrshmsmagpq.supabase.co/auth/v1/callback`), which redirects back to the app (`clemsonrides://auth/callback` or `clemsonrides-driver://auth/callback`).
   - `completeGoogleSession` in `googleAuth.js` exchanges the session tokens and establishes authentication in Supabase client.
   - The user profile is automatically verified and ensured in `public.profiles`.

3. **Verify Automated Tests:**
   ```bash
   npm test
   ```
   All test suites, including `packages/rides-native/googleAuthConfig.test.js` and `packages/rides-native/googleAuth.test.js`, will pass.
