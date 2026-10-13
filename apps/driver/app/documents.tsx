import { useRouter, useFocusEffect } from 'expo-router'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Card, ErrorText, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { openDriverApplication } from '@/lib/openApplication'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { loadVehicle, type VehicleRow } from 'rides-native/driverDesk'
import {
  fetchMyDriverDocuments,
  uploadDriverDocument,
} from 'rides-native/driverOnboardingClient'
import {
  DOCUMENT_CATEGORIES,
  categoryAttention,
  categorySlots,
  type CategoryAttention,
  type CategorySlot,
  type DocumentCategoryId,
  type DocumentRow,
} from 'rides-native/documentCategories'
import { extractReadableText, licensePendingCopy, matchRegistration, reviewLicenseImage } from 'rides-native/documentReview'
import { Glyph } from 'rides-native/icons'

type PickedFile = { uri: string; name?: string; mimeType?: string; size?: number; width?: number; height?: number }

function tabIcon(id: DocumentCategoryId): string {
  switch (id) {
    case 'license':
      return 'card'
    case 'insurance':
      return 'shield'
    case 'registration':
      return 'document-text'
    case 'vehicle':
      return 'car'
    default: {
      const unknown: never = id
      return unknown
    }
  }
}

function filedOn(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function slotDetail(slot: CategorySlot): string {
  if (!slot.uploaded) return 'Not uploaded yet'
  const note = String(slot.row?.review_note || '').trim()
  const when = filedOn(slot.row?.created_at)
  if (note && when) return `${note} · ${when}`
  if (note) return note
  if (when) return `On file · ${when}`
  return 'On file'
}

function allowsFile(docType: string): boolean {
  return docType !== 'license_front' && docType !== 'license_back'
}

async function pickDocument(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['image/*', 'application/pdf'],
    copyToCacheDirectory: true,
    multiple: false,
  })
  if (result.canceled || !result.assets?.[0]) return null
  const asset = result.assets[0]
  return { uri: asset.uri, name: asset.name, mimeType: asset.mimeType || undefined, size: asset.size }
}

async function takePhoto(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync()
  if (!perm.granted) throw new Error('Camera permission is required to photograph documents.')
  const shot = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.7,
  })
  if (shot.canceled || !shot.assets?.[0]) return null
  const asset = shot.assets[0]
  return {
    uri: asset.uri,
    name: asset.fileName || 'photo.jpg',
    mimeType: asset.mimeType || 'image/jpeg',
    size: asset.fileSize,
    width: asset.width,
    height: asset.height,
  }
}

async function pickLibrary(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) throw new Error('Photo library permission is required to choose a picture.')
  const shot = await ImagePicker.launchImageLibraryAsync({
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
    width: asset.width,
    height: asset.height,
  }
}

type UploadMeta = { reviewStatus?: string; reviewNote?: string; matchStatus?: string }

async function reviewMeta(docType: string, file: PickedFile, vehicle: VehicleRow | null): Promise<{ meta: UploadMeta; notice: string }> {
  if (docType === 'license_front' || docType === 'license_back') {
    const review = reviewLicenseImage({
      mimeType: file.mimeType,
      size: file.size,
      width: file.width,
      height: file.height,
    })
    if (!review.ok || !review.reviewStatus) throw new Error(review.message)
    return {
      meta: { reviewStatus: review.reviewStatus, reviewNote: review.message },
      notice: licensePendingCopy(docType),
    }
  }
  if (docType === 'registration') {
    const response = await fetch(file.uri)
    const text = extractReadableText(new Uint8Array(await response.arrayBuffer()))
    const match = matchRegistration({
      text,
      make: vehicle?.make || '',
      model: vehicle?.model || '',
      color: vehicle?.color || '',
      plate: vehicle?.plate || '',
    })
    return {
      meta: { reviewStatus: match.reviewStatus, matchStatus: match.status, reviewNote: match.message },
      notice: match.message,
    }
  }
  return { meta: {}, notice: 'Uploaded. It stays in review until it is approved.' }
}

export default function DocumentsScreen() {
  const router = useRouter()
  const { colors, scheme } = useTheme()
  const { user } = useAuth()
  const [tabId, setTabId] = useState<DocumentCategoryId>('license')
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyType, setBusyType] = useState<string | null>(null)
  const [chooser, setChooser] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user || !supabase) {
      setDocuments([])
      setVehicle(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [docs, car] = await Promise.all([
        fetchMyDriverDocuments(supabase, user.id),
        loadVehicle(supabase, user.id).catch(() => null),
      ])
      setDocuments(docs)
      setVehicle(car)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load documents')
    } finally {
      setLoading(false)
    }
  }, [user])

  useFocusEffect(useCallback(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load documents'))
  }, [refresh]))

  const active = DOCUMENT_CATEGORIES.find((category) => category.id === tabId) ?? DOCUMENT_CATEGORIES[0]
  const sectionStatus = categoryAttention(active?.id || 'license', documents)
  const slots = categorySlots(active?.id || 'license', documents)

  async function onUpload(docType: string, file: PickedFile | null) {
    if (!file || !user || !supabase) return
    setBusyType(docType)
    setError(null)
    setNotice(null)
    try {
      const reviewed = await reviewMeta(docType, file, vehicle)
      await uploadDriverDocument(supabase, user.id, docType, file, reviewed.meta)
      setChooser(null)
      await refresh()
      setNotice(reviewed.notice)
      if (docType === 'registration' && reviewed.meta.matchStatus && reviewed.meta.matchStatus !== 'matched') {
        setError(reviewed.notice)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusyType(null)
    }
  }

  return (
    <StackPage title="Documents" onBack={() => router.back()}>
      <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
        Each tab is approved only when every required file in it is approved. Anything else needs your attention.
      </Text>
      <View style={styles.tabs}>
        {DOCUMENT_CATEGORIES.map((category) => {
          const status = categoryAttention(category.id, documents)
          const selected = category.id === active?.id
          return (
            <Pressable
              key={category.id}
              onPress={() => {
                setTabId(category.id)
                setChooser(null)
                setNotice(null)
              }}
              accessibilityRole="tab"
              accessibilityLabel={status.approved ? `${category.label}, approved` : `${category.label}, ${status.label}`}
              accessibilityState={{ selected }}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              style={[
                styles.tab,
                {
                  backgroundColor: selected ? colors.orangeSoft : colors.card,
                  borderColor: selected ? colors.orange : colors.border,
                },
              ]}
            >
              <View style={styles.tabTop}>
                <Glyph name={tabIcon(category.id)} size={18} color={selected ? colors.orange : colors.title} />
                <Text style={[styles.tabLabel, { color: colors.title }]}>{category.label}</Text>
              </View>
              <StatusMark status={status} scheme={scheme} />
            </Pressable>
          )
        })}
      </View>

      {!user ? (
        <Card>
          <Text style={[styles.sectionTitle, { color: colors.title }]}>Sign in to manage documents</Text>
          <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
            Uploads stay on your driver account.
          </Text>
          <Primary label="Sign in" onPress={() => router.push('/sign-in')} />
        </Card>
      ) : (
        <Card>
          <Text style={[styles.sectionTitle, { color: colors.title }]}>{active?.label}</Text>
          <StatusMark status={sectionStatus} scheme={scheme} />
          <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
            {loading ? 'Loading your uploads…' : 'Use Upload for a missing file and Replace to send a new one. A replacement goes back through review.'}
          </Text>
          {error ? <ErrorText>{error}</ErrorText> : null}
          {notice && !error ? <Text style={{ color: colors.title, fontWeight: '700' }}>{notice}</Text> : null}
          {slots.map((slot) => (
            <DocumentSlot
              key={slot.id}
              slot={slot}
              busy={busyType === slot.id}
              locked={Boolean(busyType)}
              open={chooser === slot.id}
              onToggle={() => setChooser((current) => (current === slot.id ? null : slot.id))}
              onPick={(file) => onUpload(slot.id, file)}
              onError={setError}
            />
          ))}
        </Card>
      )}
      <Primary
        label="Open application"
        onPress={() => openDriverApplication(router)}
        tone="purple"
        accessibilityHint="Opens your driver application"
      />
    </StackPage>
  )
}

function StatusMark({ status, scheme }: { status: CategoryAttention; scheme: 'light' | 'dark' }) {
  const { colors } = useTheme()
  const ok = status.mark === 'check'
  const color = ok ? colors.online : colors.danger
  const soft = ok
    ? colors.onlineSoft
    : scheme === 'dark' ? 'rgba(255,139,128,0.16)' : 'rgba(180,35,24,0.12)'
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={ok ? 'Approved' : status.label}
      style={styles.status}
    >
      <View style={[styles.badge, { backgroundColor: soft }]}>
        <Glyph name={ok ? 'check' : 'close'} size={16} color={color} />
      </View>
      {ok ? null : <Text style={[styles.attention, { color }]}>{status.label}</Text>}
    </View>
  )
}

function DocumentSlot({
  slot,
  busy,
  locked,
  open,
  onToggle,
  onPick,
  onError,
}: {
  slot: CategorySlot
  busy: boolean
  locked: boolean
  open: boolean
  onToggle: () => void
  onPick: (file: PickedFile | null) => void
  onError: (message: string) => void
}) {
  const { colors } = useTheme()
  const action = slot.action === 'replace' ? 'Replace' : 'Upload'

  async function run(pick: () => Promise<PickedFile | null>, fallback: string) {
    try {
      onPick(await pick())
    } catch (err) {
      onError(err instanceof Error ? err.message : fallback)
    }
  }

  return (
    <View style={[styles.slot, { borderTopColor: colors.border }]}>
      <Text style={[styles.slotTitle, { color: colors.ink }]}>{slot.label}</Text>
      <Text style={{ color: colors.inkSecondary, lineHeight: 18 }}>{slot.hint}</Text>
      <Text style={{ color: colors.title, fontWeight: '700' }}>{slotDetail(slot)}</Text>
      <Primary
        label={busy ? 'Uploading…' : action}
        onPress={onToggle}
        disabled={locked}
        tone={slot.action === 'replace' ? 'purple' : 'orange'}
        accessibilityLabel={`${action} ${slot.label}`}
      />
      {open ? (
        <View style={styles.choices}>
          <Choice label="Camera" accessibilityLabel={`Take a photo for ${slot.label}`} disabled={locked} onPress={() => run(takePhoto, 'Camera failed')} />
          <Choice label="Photo library" accessibilityLabel={`Choose a photo for ${slot.label}`} disabled={locked} onPress={() => run(pickLibrary, 'Could not open the photo library')} />
          {allowsFile(slot.id) ? (
            <Choice label="Files" accessibilityLabel={`Choose a file for ${slot.label}`} disabled={locked} onPress={() => run(pickDocument, 'Could not open files')} />
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function Choice({
  label,
  accessibilityLabel,
  onPress,
  disabled,
}: {
  label: string
  accessibilityLabel: string
  onPress: () => void
  disabled?: boolean
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      style={[styles.choice, { borderColor: colors.border, backgroundColor: colors.input, opacity: disabled ? 0.55 : 1 }]}
    >
      <Text style={{ color: colors.title, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tab: {
    width: '48%',
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 12,
    gap: 8,
    minHeight: 108,
    marginBottom: 8,
  },
  tabTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tabLabel: { fontWeight: '800', fontSize: 15, lineHeight: 20, flex: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  attention: { fontWeight: '800', fontSize: 12, lineHeight: 16, flexShrink: 1 },
  sectionTitle: { fontSize: 22, fontWeight: '800' },
  slot: { gap: 8, paddingTop: 14, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth },
  slotTitle: { fontWeight: '800', fontSize: 16 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
})
