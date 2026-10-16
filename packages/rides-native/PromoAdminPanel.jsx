import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native'
import { createPromoCodes, exportPromoCodes, loadPromoAdmin, savePromoAutoSettings, updatePromoCode } from './promoAdminClient.js'
import { describePromo } from '../../shared/promoCodes.js'

const DAY_MS = 24 * 60 * 60 * 1000

function dollarsToCents(text) {
  const n = Number(String(text || '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

function shortDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const EMPTY = {
  side: 'rider',
  discountType: 'percent',
  amount: '',
  cap: '15',
  minTrip: '',
  days: '30',
  code: '',
  prefix: '',
  count: '',
  campaign: '',
  publicListing: false,
}

/**
 * Turns the form into the promo-create body. The server re-validates everything.
 * Every code is single-use, so there is no max-uses field: "How many" makes
 * that many unique single-use codes.
 */
export function promoFormToRequest(form, now = new Date()) {
  const days = Math.max(1, Math.min(366, Math.round(Number(form.days) || 30)))
  const body = {
    side: form.side,
    discountType: form.side === 'driver' ? 'flat' : form.discountType,
    expiresAt: new Date(now.getTime() + days * DAY_MS).toISOString(),
    minTripCents: dollarsToCents(form.minTrip),
    publicListing: Boolean(form.publicListing),
    ...(form.campaign ? { campaign: String(form.campaign).trim() } : {}),
  }
  if (body.discountType === 'percent') {
    body.percentOff = Number(form.amount) || 0
    const cap = dollarsToCents(form.cap)
    if (cap) body.maxDiscountCents = cap
  } else {
    body.amountOffCents = dollarsToCents(form.amount)
  }
  const count = Math.round(Number(form.count) || 0)
  if (count > 1 || (form.prefix && !form.code)) {
    body.prefix = String(form.prefix || '').toUpperCase()
    body.count = Math.max(1, count)
  } else if (form.code) {
    body.code = String(form.code).toUpperCase()
  } else {
    body.count = 1
  }
  return body
}

/**
 * Driver app Admin: Clemson Rides promo codes. Renders nothing unless the
 * server says this account is the promo admin (johnmatveyev@gmail.com).
 */
export function PromoAdminPanel({ supabase, colors }) {
  const [data, setData] = useState(null)
  const [hidden, setHidden] = useState(false)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const ink = colors?.title || '#522D80'
  const muted = colors?.inkSecondary || '#666'
  const accent = colors?.purple || '#522D80'

  const reload = useCallback(() => loadPromoAdmin(supabase)
    .then((d) => { setData(d); setError('') })
    .catch((err) => {
      if (err?.status === 403 || err?.status === 401) setHidden(true)
      else setError(err?.message || 'Could not load promo codes')
    }), [supabase])

  useEffect(() => { reload() }, [reload])

  if (hidden || !data?.admin) return null
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }))

  async function create() {
    setBusy('create')
    setError('')
    try {
      const out = await createPromoCodes(supabase, promoFormToRequest(form))
      const codes = (out?.codes || []).map((c) => c.code)
      Alert.alert('Codes created', codes.length > 6 ? `${codes.length} codes` : codes.join(', '))
      setForm(EMPTY)
      setOpen(false)
      await reload()
    } catch (err) {
      setError(err?.payload?.error || err?.message || 'Could not create codes')
    } finally {
      setBusy('')
    }
  }

  async function toggle(row) {
    setBusy(row.id)
    try {
      await updatePromoCode(supabase, row.id, { active: !row.active })
      await reload()
    } catch (err) {
      setError(err?.payload?.error || err?.message || 'Could not update that code')
    } finally {
      setBusy('')
    }
  }

  async function exportCsv() {
    setBusy('export')
    try {
      const out = await exportPromoCodes(supabase)
      await Share.share({ title: 'Clemson Rides promo codes', message: out?.csv || '' })
    } catch (err) {
      setError(err?.message || 'Could not export codes')
    } finally {
      setBusy('')
    }
  }

  const field = (label, key, props = {}) => (
    <View style={{ gap: 2, flexBasis: '45%', flexGrow: 1 }}>
      <Text style={{ color: muted, fontSize: 12 }}>{label}</Text>
      <TextInput
        value={String(form[key] ?? '')}
        onChangeText={set(key)}
        accessibilityLabel={label}
        autoCapitalize="characters"
        autoCorrect={false}
        style={{ minHeight: 40, borderWidth: 1, borderColor: accent, borderRadius: 8, paddingHorizontal: 8, color: ink }}
        {...props}
      />
    </View>
  )
  const chip = (label, active, onPress) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center', borderWidth: 1, borderColor: accent, backgroundColor: active ? accent : 'transparent' }}
    >
      <Text style={{ color: active ? '#fff' : accent, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  )
  const button = (label, onPress, key) => (
    <Pressable
      onPress={onPress}
      disabled={Boolean(busy)}
      accessibilityRole="button"
      style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center', backgroundColor: accent, opacity: busy && busy !== key ? 0.5 : 1 }}
    >
      <Text style={{ color: '#fff', fontWeight: '800' }}>{busy === key ? '…' : label}</Text>
    </Pressable>
  )

  const codes = data.codes || []
  return (
    <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ padding: 16, gap: 8 }} accessibilityLabel="Promo codes">
      <Text style={{ color: ink, fontSize: 18, fontWeight: '800' }}>Promo codes</Text>
      <Text style={{ color: muted, fontSize: 13 }}>
        One promo per ride. Rider discounts come out of the platform share; driver pay is on the full fare.
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {button(open ? 'Close' : 'New code', () => setOpen((o) => !o), 'toggle')}
        {button('Export CSV', () => { void exportCsv() }, 'export')}
      </View>
      {open ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {chip('Rider', form.side === 'rider', () => set('side')('rider'))}
            {chip('Driver', form.side === 'driver', () => setForm((f) => ({ ...f, side: 'driver', discountType: 'flat' })))}
            {form.side === 'rider' ? chip('% off', form.discountType === 'percent', () => set('discountType')('percent')) : null}
            {chip('$ off', form.discountType === 'flat', () => set('discountType')('flat'))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {field(form.discountType === 'percent' ? 'Percent off (max 50)' : (form.side === 'driver' ? 'Bonus $ (max 50)' : 'Dollars off (max 50)'), 'amount', { keyboardType: 'decimal-pad' })}
            {form.discountType === 'percent' ? field('Cap $ per ride', 'cap', { keyboardType: 'decimal-pad' }) : null}
            {form.side === 'rider' ? field('Minimum trip $', 'minTrip', { keyboardType: 'decimal-pad' }) : null}
            {field('Expires in days (max 366)', 'days', { keyboardType: 'number-pad' })}
            {field('Exact code (optional)', 'code')}
            {field('Or prefix', 'prefix')}
            {field('How many single-use codes (max 500)', 'count', { keyboardType: 'number-pad' })}
            {field('Campaign', 'campaign', { autoCapitalize: 'none' })}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {form.side === 'rider' ? chip(form.publicListing ? 'Listed on site' : 'Not listed on site', form.publicListing, () => set('publicListing')(!form.publicListing)) : null}
          </View>
          <Text style={{ color: muted, fontSize: 12 }}>
            Every code works once, ever. A batch gives each person one code: one per account, device and card. Terms cannot change after issue; turn a code off and issue a new one instead.
          </Text>
          {button('Create', () => { void create() }, 'create')}
        </View>
      ) : null}
      {data.auto ? (
        <AutoSettings auto={data.auto} busy={busy} setBusy={setBusy} setError={setError} reload={reload} supabase={supabase} ink={ink} muted={muted} accent={accent} />
      ) : null}
      {error ? <Text style={{ color: '#B00020' }} accessibilityRole="alert">{error}</Text> : null}
      {codes.length === 0 ? <Text style={{ color: muted }}>No codes yet.</Text> : null}
      {codes.slice(0, 50).map((row) => (
        <View key={row.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: ink, fontWeight: '800' }}>{row.code}{row.active ? '' : ' (off)'}</Text>
            <Text style={{ color: muted, fontSize: 12 }}>
              {describePromo(row)} · {row.side} · {row.counts?.redeemed ? 'used' : 'single-use'}
              {row.counts?.reserved ? ` · ${row.counts.reserved} on rides` : ''}
              {row.counts?.claimed ? ` · ${row.counts.claimed} saved` : ''} · ends {shortDate(row.expires_at)}
            </Text>
          </View>
          {button(row.active ? 'Turn off' : 'Turn on', () => { void toggle(row) }, row.id)}
        </View>
      ))}
    </ScrollView>
  )
}

/** Auto-issued codes (sign-up, first card, $50 credits). Changes apply to codes issued after saving. */
function AutoSettings({ auto, busy, setBusy, setError, reload, supabase, ink, muted, accent }) {
  const [percent, setPercent] = useState(String(auto.percentOff ?? 50))
  const [cap, setCap] = useState(auto.maxDiscountCents ? String(auto.maxDiscountCents / 100) : '')
  const [days, setDays] = useState(String(auto.expiresDays ?? 90))

  async function save(extra = {}) {
    setBusy('auto')
    setError('')
    try {
      await savePromoAutoSettings(supabase, {
        percentOff: Number(percent),
        maxDiscountCents: cap ? dollarsToCents(cap) : null,
        expiresDays: Number(days),
        ...extra,
      })
      await reload()
    } catch (err) {
      setError(err?.payload?.error || err?.message || 'Could not save auto codes')
    } finally {
      setBusy('')
    }
  }

  const input = (label, value, onChange) => (
    <View style={{ gap: 2, flexBasis: '30%', flexGrow: 1 }}>
      <Text style={{ color: muted, fontSize: 12 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        keyboardType="decimal-pad"
        style={{ minHeight: 40, borderWidth: 1, borderColor: accent, borderRadius: 8, paddingHorizontal: 8, color: ink }}
      />
    </View>
  )
  return (
    <View style={{ gap: 6, paddingTop: 8 }}>
      <Text style={{ color: ink, fontSize: 16, fontWeight: '800' }}>Auto codes</Text>
      <Text style={{ color: muted, fontSize: 12 }}>
        One single-use code per account for each of: new account, first card, credits reaching $50.
        {' '}Issuing is {auto.issueEnabled ? 'on' : 'off'}. Emails are {auto.emailsEnabled ? 'on' : 'off (PROMO_CODE_EMAILS_ENABLED)'}.
        {' '}{auto.maxDiscountCents ? `Capped at $${(auto.maxDiscountCents / 100).toFixed(2)} per ride.` : 'No dollar cap: 50% of a long airport fare is a large discount.'}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {input('Percent off (max 50)', percent, setPercent)}
        {input('Cap $ per ride (empty = none)', cap, setCap)}
        {input('Expires in days', days, setDays)}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pressable onPress={() => { void save() }} disabled={Boolean(busy)} accessibilityRole="button"
          style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center', backgroundColor: accent }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>{busy === 'auto' ? '…' : 'Save auto codes'}</Text>
        </Pressable>
        <Pressable onPress={() => { void save({ issueEnabled: !auto.issueEnabled }) }} disabled={Boolean(busy)} accessibilityRole="button"
          style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center', borderWidth: 1, borderColor: accent }}>
          <Text style={{ color: accent, fontWeight: '800' }}>{auto.issueEnabled ? 'Stop issuing' : 'Start issuing'}</Text>
        </Pressable>
      </View>
    </View>
  )
}
