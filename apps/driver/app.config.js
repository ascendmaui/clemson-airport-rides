const appJson = require('./app.json')

function mapsKey() {
  const raw = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_ANDROID_API_KEY || ''
  const key = String(raw).trim()
  if (!key || /placeholder|your_google|your_android/i.test(key)) return ''
  return key
}

module.exports = () => {
  const expo = appJson.expo
  const key = mapsKey()
  const android = { ...expo.android }
  if (key) {
    android.config = {
      ...(android.config || {}),
      googleMaps: { apiKey: key },
    }
  }
  return { expo: { ...expo, android } }
}
