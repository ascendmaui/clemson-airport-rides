# Clemson RIDES — Expo mobile

Bundle id: `com.ascendmaui.clemsonairportrides`

Auth: **Supabase Auth only** (Clerk removed). Data: Supabase.

```bash
cp .env.example .env
# fill EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY
npm install
npx expo start
```

EAS: see `eas.json` (preview / production). Requires Xcode developer dir:
`sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
