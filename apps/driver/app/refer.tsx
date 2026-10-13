import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Share, Text, TextInput } from 'react-native'
import { Card, ErrorText, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { claimDriverReferral, loadDriverPerks, type ReferralSummary } from 'rides-native/driverDesk'

const CLAIM_COPY: Record<string, string> = {
  unknown_code: 'That code was not found.',
  own_code: 'You can’t use your own code.',
  already_claimed: 'You already used a referral code.',
  too_late: 'Codes must be added before your first completed trip.',
}

export default function ReferScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const [ref, setRef] = useState<ReferralSummary | null>(null)
  const [code, setCode] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useFocusEffect(useCallback(() => {
    if (!supabase) return undefined
    loadDriverPerks(supabase).then((p) => setRef((p.referral as ReferralSummary) || null)).catch((e: Error) => setError(e.message))
    return undefined
  }, []))

  const bonus = ref ? `$${(ref.bonusCents / 100).toFixed(0)}` : ''
  return (
    <StackPage title="Refer drivers" onBack={() => router.back()}>
      <Card>
        <Text style={{ color: colors.title, fontWeight: '800', fontSize: 18 }}>Invite a driver</Text>
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
          {ref?.enabled
            ? `Earn ${bonus} when a driver you refer completes ${ref.targetTrips} trips. It lands in your payouts.`
            : 'Share Clemson RIDES with a friend who wants to drive.'}
        </Text>
        {ref?.code ? (
          <Text selectable style={{ color: colors.orange, fontWeight: '800', fontSize: 24, letterSpacing: 2 }} accessibilityLabel={`Your code ${ref.code.split('').join(' ')}`}>
            {ref.code}
          </Text>
        ) : null}
        <Primary
          label="Share link"
          onPress={() => {
            const msg = ref?.link
              ? `Drive with Clemson RIDES. Sign up with my code ${ref.code}: ${ref.link}`
              : 'Drive with Clemson RIDES. Campus and airport trips for Clemson students.'
            Share.share({ message: msg }).catch(() => {})
          }}
        />
      </Card>
      {ref?.referrals?.length ? (
        <Card>
          <Text style={{ color: colors.title, fontWeight: '800' }}>Your referrals</Text>
          {ref.referrals.map((r, i) => (
            <Text key={i} style={{ color: colors.inkSecondary }}>
              {r.status === 'qualified' ? `Driver ${i + 1}: bonus earned` : `Driver ${i + 1}: ${r.trips}/${r.target} trips`}
            </Text>
          ))}
        </Card>
      ) : null}
      <Card>
        <Text style={{ color: colors.title, fontWeight: '800' }}>Were you referred?</Text>
        <TextInput
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          placeholder="Referral code"
          placeholderTextColor={colors.inkSecondary}
          accessibilityLabel="Referral code"
          style={{ color: colors.ink, borderColor: colors.track, borderWidth: 1, borderRadius: 12, padding: 12 }}
        />
        <Primary
          label="Add code"
          onPress={async () => {
            if (!supabase || !code.trim()) return
            setError(null)
            const r = await claimDriverReferral(supabase, code).catch((e: Error) => ({ ok: false, error: e.message }))
            if (r.ok) setNote('Code added. Your friend earns the bonus after your qualifying trips.')
            else setError(CLAIM_COPY[r.error || ''] || r.error || 'Could not add the code.')
          }}
        />
        {note ? <Text style={{ color: colors.inkSecondary }}>{note}</Text> : null}
      </Card>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </StackPage>
  )
}
