import { useFocusEffect, useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { useCallback, useMemo, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { authedJson } from 'rides-native/apiClient'
import { BackButton, Card, ErrorText, Primary } from '@/components/chrome'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { driverProfilePhotoMessage } from '../../../shared/profilePhotoReview.js'

export default function ProfilePhotoScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors } = useTheme()
  const styles = useMemo(() => StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    list: { padding: 16, gap: 12 },
    title: { fontSize: 28, fontWeight: '800', color: colors.title },
    copy: { fontSize: 15, lineHeight: 21, color: colors.inkSecondary },
    note: { fontWeight: '700', color: colors.title },
  }), [colors])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const request = useRef(0)

  useFocusEffect(useCallback(() => {
    if (!user || !supabase) return undefined
    const token = ++request.current
    let alive = true
    authedJson(supabase, '/api/driver?action=profile-photo')
      .then((data) => {
        const photo = (data as { photo?: { reviewStatus?: string, driverMessage?: string } | null })?.photo
        if (!alive || token !== request.current || !photo?.reviewStatus) return
        setNote(photo.driverMessage || driverProfilePhotoMessage(photo.reviewStatus))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [user]))

  async function choose(source: 'library' | 'camera') {
    if (!user || !supabase) return
    setBusy(true)
    setError(null)
    try {
      const permission = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) throw new Error(source === 'camera' ? 'Camera permission is required.' : 'Photo library permission is required.')
      const shot = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 })
      if (shot.canceled || !shot.assets?.[0]) return
      const token = ++request.current
      setNote(null)
      const asset = shot.assets[0]
      const mime = asset.mimeType || 'image/jpeg'
      if (!mime.startsWith('image/')) throw new Error('Choose a photo.')
      if (asset.fileSize && asset.fileSize < 12_000) throw new Error('That photo is too small. Choose a clearer picture of yourself.')
      if (asset.fileSize && asset.fileSize > 8 * 1024 * 1024) throw new Error('Each photo must be 8MB or smaller.')
      const response = await fetch(asset.uri)
      const bytes = await response.arrayBuffer()
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('heic') || mime.includes('heif') ? 'heic' : 'jpg'
      const path = `${user.id}/profile_photo/${Date.now()}.${ext}`
      const uploaded = await supabase.storage.from('driver-documents').upload(path, bytes, {
        contentType: asset.mimeType || 'image/jpeg',
        upsert: false,
      })
      if (uploaded.error) throw new Error(uploaded.error.message)
      const review = await authedJson(supabase, '/api/driver?action=profile-photo', {
        method: 'POST',
        body: { storagePath: path },
      }) as { driverMessage?: string, reviewStatus?: string }
      if (token === request.current) {
        setNote(review.driverMessage || driverProfilePhotoMessage(review.reviewStatus))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that photo')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <ScrollView contentContainerStyle={styles.list}>
        <BackButton onPress={() => router.back()} />
        <Text style={styles.title}>Profile photo</Text>
        <Card>
          <Text style={styles.copy}>Add a photo of yourself from your library or the camera. We compare it with the license already on file. A clear match is approved. Anything else waits for an admin, usually within a day.</Text>
          {error ? <ErrorText>{error}</ErrorText> : null}
          {note ? <Text style={styles.note} accessibilityLiveRegion="polite">{note}</Text> : null}
          <Primary label={busy ? 'Saving…' : 'Photo library'} onPress={() => choose('library')} disabled={busy || !user} />
          <Primary label="Camera" onPress={() => choose('camera')} disabled={busy || !user} tone="purple" />
        </Card>
      </ScrollView>
    </View>
  )
}
