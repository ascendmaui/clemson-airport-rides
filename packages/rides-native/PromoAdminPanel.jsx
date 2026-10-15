import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native'
import { createPromoCodes, exportPromoCodes, loadPromoAdmin, updatePromoCode } from './promoAdminClient.js'
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
  maxRedemptions: '100',
  perAccount: '1',
  code: '',
  prefix: '',
  count: '',
  campaign: '',
  publicListing: false,
}

/** Turns the form into the promo-create body. The server re-validates everything. */
export function promoFormToRequest(form, now = new Date()) {
  const days = Math.max(1, Math.min(366, Math.round(Number(form.days) || 30)))
  const body = {
    side: form.side,
    discountType: form.side === 'driver' ? 'flat' : form.discountType,
    expiresAt: new Date(now.getTime() + days * DAY_MS).toISOString(),
    maxRedemptions: Math.round(Number(form.maxRedemptions) || 0),
    perAccountLimit: Math.round(Number(form.perAccount) || 1),
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
            {field('Max redemptions', 'maxRedemptions', { keyboardType: 'number-pad' })}
            {field('Per account', 'perAccount', { keyboardType: 'number-pad' })}
            {field('Exact code (optional)', 'code')}
            {field('Or prefix', 'prefix')}
            {field('How many (max 500)', 'count', { keyboardType: 'number-pad' })}
            {field('Campaign', 'campaign', { autoCapitalize: 'none' })}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {form.side === 'rider' ? chip(form.publicListing ? 'Listed on site' : 'Not listed on site', form.publicListing, () => set('publicListing')(!form.publicListing)) : null}
          </View>
          <Text style={{ color: muted, fontSize: 12 }}>
            One use per device and per card is on for every code. Terms cannot change after issue; deactivate and issue a new code instead.
          </Text>
          {button('Create', () => { void create() }, 'create')}
        </View>
      ) : null}
      {error ? <Text style={{ color: '#B00020' }} accessibilityRole="alert">{error}</Text> : null}
      {codes.length === 0 ? <Text style={{ color: muted }}>No codes yet.</Text> : null}
      {codes.slice(0, 50).map((row) => (
        <View key={row.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: ink, fontWeight: '800' }}>{row.code}{row.active ? '' : ' (off)'}</Text>
            <Text style={{ color: muted, fontSize: 12 }}>
              {describePromo(row)} · {row.side} · used {row.counts?.redeemed || 0}/{row.max_redemptions}
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
