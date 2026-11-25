import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { type as typeScale } from 'rides-native/shared/theme.js'
import { Card, ErrorText, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { openDriverApplication } from '@/lib/openApplication'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { loadVehicle, type VehicleRow } from 'rides-native/driverDesk'
import {
  fetchInspectionDeadline,
  fetchMyDriverDocuments,
  uploadDriverDocument,
} from 'rides-native/driverOnboardingClient'
import {
  ATTENTION_COPY,
  DOCUMENT_CATEGORIES,
  categoryAttention,
  categorySlots,
  type CategoryAttention,
  type CategorySlot,
  type DocumentCategoryId,
  type DocumentRow,
} from 'rides-native/documentCategories'
import { attentionScreenItems } from 'rides-native/goPress'
import {
  INSPECTION_FORM_TYPE,
  INSPECTION_OVERDUE_COPY,
  INSPECTION_SOURCES,
  INSPECTION_TAB_LABEL,
  inspectionAttention,
  inspectionCountdown,
  inspectionGoOnlineGate,
  inspectionSlots,
  inspectionSubmitted,
  isInspectionSource,
} from 'rides-native/vehicleInspection'
import { extractReadableText, licensePendingCopy, matchRegistration, reviewLicenseImage } from 'rides-native/documentReview'
import { Glyph } from 'rides-native/icons'
import { quietly } from '@/lib/softFail'

type PickedFile = { uri: string; name?: string; mimeType?: string; size?: number; width?: number; height?: number }
type DocumentsTabId = DocumentCategoryId | 'inspection'

function tabIcon(id: DocumentsTabId): string {
  switch (id) {
    case 'license':
      return 'card'
    case 'insurance':
      return 'shield'
    case 'registration':
      return 'document-text'
    case 'vehicle':
      return 'car'
    case 'inspection':
      return 'receipt'
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

type UploadMeta = { reviewStatus?: string; reviewNote?: string; matchStatus?: string; inspectionSource?: string | null }

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
  const params = useLocalSearchParams<{ attention?: string }>()
  const attentionMode = params.attention === '1'
  const { colors, scheme } = useTheme()
  const { user } = useAuth()
  const [tabId, setTabId] = useState<DocumentsTabId>('license')
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [inspectionDueAt, setInspectionDueAt] = useState<string | null>(null)
  const [inspectionSource, setInspectionSource] = useState<string | null>(null)
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyType, setBusyType] = useState<string | null>(null)
  const [chooser, setChooser] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user || !supabase) {
      setDocuments([])
      setInspectionDueAt(null)
      setVehicle(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [docs, car, deadline] = await Promise.all([
        fetchMyDriverDocuments(supabase, user.id),
        loadVehicle(supabase, user.id).catch(quietly('documents vehicle', null)),
        fetchInspectionDeadline(supabase, user.id).catch(quietly('documents inspection deadline', null)),
      ])
      setDocuments(docs)
      setInspectionDueAt(deadline?.inspection_due_at ?? null)
      const savedSource = docs.find((row) => (row.doc_type || row.type) === INSPECTION_FORM_TYPE)?.inspection_source
      if (isInspectionSource(savedSource)) setInspectionSource(String(savedSource))
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

  const inspectionOpen = tabId === 'inspection'
  const active = DOCUMENT_CATEGORIES.find((category) => category.id === tabId) ?? DOCUMENT_CATEGORIES[0]
  const sectionStatus = inspectionOpen ? inspectionAttention(documents) : categoryAttention(active.id, documents)
  const slots = inspectionOpen ? inspectionSlots(documents) : categorySlots(active.id, documents)
  const sectionLabel = inspectionOpen ? INSPECTION_TAB_LABEL : active.label
  const sectionKicker = inspectionOpen || active.id === 'vehicle' ? 'VEHICLE CHECK' : String(active.label).toUpperCase()
  const inspectionReminder = inspectionCountdown({ documents, dueAt: inspectionDueAt, now: new Date() })?.message || ''
  const attentionItems = attentionScreenItems({ documents, dueAt: inspectionDueAt, now: new Date() }).items
  const inspectionGate = inspectionGoOnlineGate({ documents, dueAt: inspectionDueAt, now: new Date() })
  const inspectionInReview = inspectionSubmitted(documents) && !sectionStatus.approved

  function selectTab(next: DocumentsTabId) {
    setTabId(next)
    setChooser(null)
    setNotice(null)
  }

  async function onUpload(docType: string, file: PickedFile | null) {
    if (!file || !user || !supabase) return
    if (docType === INSPECTION_FORM_TYPE && !isInspectionSource(inspectionSource)) {
      setChooser(null)
      setError('Choose Lyft, Uber, another platform, or an independent inspection.')
      return
    }
    setBusyType(docType)
    setError(null)
    setNotice(null)
    try {
      const reviewed = await reviewMeta(docType, file, vehicle)
      const saved = await uploadDriverDocument(supabase, user.id, docType, file, {
        ...reviewed.meta,
        inspectionSource: docType === INSPECTION_FORM_TYPE ? inspectionSource : null,
      })
      setChooser(null)
      await refresh()
      setNotice(saved.driverMessage || reviewed.notice)
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
    <StackPage title={attentionMode ? ATTENTION_COPY : 'Documents'} onBack={() => router.back()}>
      <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
        Each tab is approved only when every required file in it is approved. Anything else needs your attention.
      </Text>
      <View style={styles.tabs}>
        {DOCUMENT_CATEGORIES.map((category) => {
          const status = categoryAttention(category.id, documents)
          const selected = category.id === tabId
          return (
            <Pressable
              key={category.id}
              onPress={() => selectTab(category.id)}
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
        <Pressable
          onPress={() => selectTab('inspection')}
          accessibilityRole="tab"
          accessibilityLabel={inspectionAttention(documents).approved ? `${INSPECTION_TAB_LABEL}, approved` : `${INSPECTION_TAB_LABEL}, ${inspectionAttention(documents).label}`}
          accessibilityState={{ selected: inspectionOpen }}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          style={[
            styles.tab,
            {
              backgroundColor: inspectionOpen ? colors.orangeSoft : colors.card,
              borderColor: inspectionOpen ? colors.orange : colors.border,
            },
          ]}
        >
          <View style={styles.tabTop}>
            <Glyph name={tabIcon('inspection')} size={18} color={inspectionOpen ? colors.orange : colors.title} />
            <Text style={[styles.tabLabel, { color: colors.title }]}>{INSPECTION_TAB_LABEL}</Text>
          </View>
          <StatusMark status={inspectionAttention(documents)} scheme={scheme} />
        </Pressable>
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
          {attentionMode ? (
            <View style={{ gap: 6 }}>
              <Text style={[styles.sectionTitle, { color: colors.title }]}>{ATTENTION_COPY}</Text>
              {attentionItems.length === 0 ? (
                <Text style={{ color: colors.inkSecondary }}>Nothing else is required.</Text>
              ) : attentionItems.map((item) => (
                <Text key={item.id} style={{ color: colors.ink, fontWeight: '700' }}>
                  {item.section} · {item.label} · {item.reason}
                </Text>
              ))}
            </View>
          ) : null}
          <Text style={{ color: colors.orange, ...typeScale.kickerSm }}>{sectionKicker}</Text>
          <Text style={[styles.sectionTitle, { color: colors.title }]}>{sectionLabel}</Text>
          <StatusMark status={sectionStatus} scheme={scheme} />
          {inspectionOpen && inspectionReminder ? (
            <Text style={{ color: colors.orange, fontWeight: '800' }}>{inspectionReminder}</Text>
          ) : null}
          {inspectionOpen && !inspectionGate.allowed ? (
            <Text style={{ color: colors.danger, fontWeight: '800' }}>{INSPECTION_OVERDUE_COPY}</Text>
          ) : null}
          <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
            {loading
              ? 'Loading your uploads…'
              : inspectionOpen
                ? 'Photograph the front, back, left, and right. Interior is optional. Add the inspection form and choose where it came from.'
                : 'Use Upload for a missing file and Replace to send a new one. A replacement goes back through review.'}
          </Text>
          {inspectionOpen && inspectionInReview ? (
            <Text style={{ color: colors.title, fontWeight: '700' }}>Submitted. You can go online while this is in review.</Text>
          ) : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          {notice && !error ? <Text style={{ color: colors.title, fontWeight: '700' }}>{notice}</Text> : null}
          {inspectionOpen ? (
            <View style={styles.slot}>
              <Text style={[styles.slotTitle, { color: colors.ink }]}>Where did this inspection come from?</Text>
              <View style={styles.choices}>
                {INSPECTION_SOURCES.map((source) => {
                  const selected = source.id === inspectionSource
                  return (
                    <Pressable
                      key={source.id}
                      onPress={() => setInspectionSource(source.id)}
                      accessibilityRole="button"
                      accessibilityLabel={source.label}
                      accessibilityState={{ selected }}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      style={[styles.choice, {
                        borderColor: selected ? colors.orange : colors.border,
                        backgroundColor: selected ? colors.orangeSoft : colors.input,
                      }]}
                    >
                      <Text style={{ color: colors.title, fontWeight: '800' }}>{source.label}</Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          ) : null}
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
