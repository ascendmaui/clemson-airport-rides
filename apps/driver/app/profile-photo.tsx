import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BackButton, Card, ErrorText, Primary } from '@/components/chrome'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'

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

  async function choose(source: 'library' | 'camera') {
    if (!user || !supabase) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const permission = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) throw new Error(source === 'camera' ? 'Camera permission is required.' : 'Photo library permission is required.')
      const shot = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 })
      if (shot.canceled || !shot.assets?.[0]) return
      const asset = shot.assets[0]
      const mime = asset.mimeType || 'image/jpeg'
      if (!mime.startsWith('image/')) throw new Error('Choose a photo.')
      if (asset.fileSize && asset.fileSize < 12_000) throw new Error('That photo is too small. Choose a clearer picture of yourself.')
      if (asset.fileSize && asset.fileSize > 8 * 1024 * 1024) throw new Error('Each photo must be 8MB or smaller.')
      const response = await fetch(asset.uri)
      const bytes = await response.arrayBuffer()
      const path = `${user.id}/profile_photo/${Date.now()}.jpg`
      const uploaded = await supabase.storage.from('driver-documents').upload(path, bytes, {
        contentType: asset.mimeType || 'image/jpeg',
        upsert: false,
      })
      if (uploaded.error) throw new Error(uploaded.error.message)
      const row = await supabase.from('driver_profile_photos').insert({
        profile_id: user.id,
        storage_path: path,
        review_status: 'pending_manual_review',
      })
      if (row.error && !/driver_profile_photos|schema cache|relation/i.test(row.error.message || '')) {
        throw new Error(row.error.message)
      }
      setNote('Photo received. It is pending manual review and is not approved.')
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
          <Text style={styles.copy}>Add a photo of yourself from your library or the camera. It is reviewed by hand and does not approve your account.</Text>
          {error ? <ErrorText>{error}</ErrorText> : null}
          {note ? <Text style={styles.note}>{note}</Text> : null}
          <Primary label={busy ? 'Saving…' : 'Photo library'} onPress={() => choose('library')} disabled={busy || !user} />
          <Primary label="Camera" onPress={() => choose('camera')} disabled={busy || !user} tone="purple" />
        </Card>
      </ScrollView>
    </View>
  )
}
