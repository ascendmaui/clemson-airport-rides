import { useCallback, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useFocusEffect } from 'expo-router'
import { ErrorText, Primary } from '@/components/chrome'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import {
  MAX_VEHICLE_PHOTOS,
  VEHICLE_PHOTO_KINDS,
  isVehiclePhotoKind,
  listProfileVehiclePhotos,
  listVehiclePhotos,
  removeVehiclePhoto,
  uploadVehiclePhoto,
  type VehiclePhoto,
  type VehiclePhotoKind,
} from 'rides-native/vehiclePhotos'

type PickedPhoto = {
  uri: string
  name?: string
  mimeType?: string
  size?: number
}

type Props = {
  userId: string
  includeAngles?: boolean
  readOnly?: boolean
  onManage?: () => void
}

async function pickLibrary(limit: number): Promise<PickedPhoto[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) throw new Error('Photo library permission is required.')
  const shot = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.8,
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, limit),
  })
  if (shot.canceled || !shot.assets?.length) return []
  return shot.assets.map((asset) => ({
    uri: asset.uri,
    name: asset.fileName || 'photo.jpg',
    mimeType: asset.mimeType || 'image/jpeg',
    size: asset.fileSize,
  }))
}

async function takePhoto(): Promise<PickedPhoto | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync()
  if (!perm.granted) throw new Error('Camera permission is required.')
  const shot = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.8,
  })
  if (shot.canceled || !shot.assets?.[0]) return null
  const asset = shot.assets[0]
  return {
    uri: asset.uri,
    name: asset.fileName || 'photo.jpg',
    mimeType: asset.mimeType || 'image/jpeg',
    size: asset.fileSize,
  }
}

export function VehiclePhotoGallery({ userId, includeAngles = false, readOnly = false, onManage }: Props) {
  const { colors } = useTheme()
  const [photos, setPhotos] = useState<VehiclePhoto[]>([])
  const [kind, setKind] = useState<VehiclePhotoKind>('exterior')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!supabase || !userId) {
      setPhotos([])
      return
    }
    const next = includeAngles
      ? await listProfileVehiclePhotos(supabase, userId)
      : await listVehiclePhotos(supabase, userId)
    setPhotos(next)
  }, [includeAngles, userId])

  useFocusEffect(useCallback(() => {
    let alive = true
    refresh().catch((err: unknown) => {
      if (alive) setError(err instanceof Error ? err.message : 'Could not load vehicle photos')
    })
    return () => {
      alive = false
    }
  }, [refresh]))

  async function savePicked(files: PickedPhoto[]) {
    if (!files.length) return
    if (!supabase) {
      setError('Sign in to add vehicle photos.')
      return
    }
    if (!isVehiclePhotoKind(kind)) {
      setError('Choose exterior, interior, or other.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      for (const file of files) {
        await uploadVehiclePhoto(supabase, userId, kind, file)
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that photo')
      await refresh().catch(() => {})
    } finally {
      setBusy(false)
    }
  }

  async function onLibrary() {
    const extras = photos.filter((photo) => photo.source !== 'angle').length
    const room = MAX_VEHICLE_PHOTOS - extras
    if (room <= 0) {
      setError(`You can add up to ${MAX_VEHICLE_PHOTOS} vehicle photos.`)
      return
    }
    try {
      await savePicked(await pickLibrary(room))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the photo library')
    }
  }

  async function onCamera() {
    try {
      const shot = await takePhoto()
      if (shot) await savePicked([shot])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the camera')
    }
  }

  async function onRemove(photo: VehiclePhoto) {
    if (!supabase) return
    setBusy(true)
    setError(null)
    try {
      await removeVehiclePhoto(supabase, userId, photo)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that photo')
    } finally {
      setBusy(false)
    }
  }

  const extras = photos.filter((photo) => photo.source !== 'angle')
  const atCap = extras.length >= MAX_VEHICLE_PHOTOS

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: colors.title }]}>Vehicle photos</Text>
      <Text style={[styles.copy, { color: colors.inkSecondary }]}>
        {readOnly
          ? 'Exterior, interior, and other photos saved on your driver profile.'
          : 'Add more than one photo of the exterior, interior, or another view. They show on your profile and on the web applicant review before an admin approves you.'}
      </Text>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {photos.length === 0 ? (
        <Text style={{ color: colors.inkSecondary }}>No vehicle photos yet.</Text>
      ) : (
        <View style={styles.grid}>
          {photos.map((photo) => (
            <View key={`${photo.source}-${photo.id}`} style={[styles.tile, { backgroundColor: colors.track }]}>
              <Text style={[styles.tileLabel, { color: colors.purple }]}>{photo.label}</Text>
              {photo.url ? (
                <Image source={{ uri: photo.url }} style={styles.image} accessibilityLabel={`${photo.label} vehicle photo`} />
              ) : (
                <Text style={{ color: colors.inkSecondary, padding: 8 }}>Preview unavailable</Text>
              )}
              {!readOnly && photo.source !== 'angle' ? (
                <Pressable
                  onPress={() => onRemove(photo)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${photo.label} photo`}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.remove}
              >
                <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>Remove</Text>
              </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      )}
      {readOnly && onManage ? (
        <Primary label="Manage vehicle photos" onPress={onManage} tone="ghost" />
      ) : null}
      {!readOnly ? (
        <View style={styles.kinds}>
          {VEHICLE_PHOTO_KINDS.map((item) => {
            const selected = kind === item.id
            return (
              <Pressable
                key={item.id}
                onPress={() => setKind(item.id)}
                accessibilityRole="radio"
                accessibilityLabel={item.label}
                accessibilityState={{ selected }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={[styles.kind, { backgroundColor: selected ? colors.orange : colors.card, borderColor: colors.border }]}
              >
                <Text style={{ color: selected ? colors.onAccent : colors.purple, fontWeight: '700', fontSize: 12 }}>{item.label}</Text>
              </Pressable>
            )
          })}
        </View>
      ) : null}
      {!readOnly ? (
        <>
          <Text style={{ color: colors.inkSecondary, fontSize: 12 }}>
            {VEHICLE_PHOTO_KINDS.find((item) => item.id === kind)?.hint}. Up to {MAX_VEHICLE_PHOTOS} extra photos.
          </Text>
          <Primary
            label={busy ? 'Saving photos…' : atCap ? 'Photo limit reached' : `Add ${kind} photos`}
            onPress={onLibrary}
            disabled={busy || atCap}
          />
          <Primary label="Camera" onPress={onCamera} disabled={busy || atCap} tone="purple" />
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  title: { fontSize: 18, fontWeight: '800' },
  copy: { lineHeight: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '48%', borderRadius: 14, overflow: 'hidden' },
  tileLabel: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingTop: 6 },
  image: { width: '100%', height: 96 },
  remove: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kind: { minHeight: 44, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 14 },
})
