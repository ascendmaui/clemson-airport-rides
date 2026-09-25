import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Card, ErrorText, Primary, Tag } from '@/components/chrome'
import { useAuth } from '@/lib/auth'
import { useTheme } from '@/lib/theme'
import type { DriverGateView } from 'rides-native/driverGateView'

export type DriverStatusCardProps = {
  status: string | null | undefined
  gate: DriverGateView
  reason?: string | null
  onRefresh?: () => void | Promise<void>
  refreshing?: boolean
}

function statusBadgeLabel(status: string | null | undefined): string {
  switch (status) {
    case 'approved':
      return 'Approved'
    case 'pending_review':
      return 'Under review'
    case 'pending_docs':
      return 'Docs needed'
    case 'pending_info':
      return 'Info needed'
    case 'rejected':
      return 'Needs changes'
    default:
      return 'Not started'
  }
}

function statusBadgeTone(status: string | null | undefined): 'purple' | 'orange' {
  switch (status) {
    case 'approved':
      return 'purple'
    case 'pending_review':
    case 'pending_docs':
    case 'pending_info':
    case 'rejected':
    default:
      return 'orange'
  }
}

export function DriverStatusCard({
  status,
  gate,
  reason,
  onRefresh,
  refreshing = false,
}: DriverStatusCardProps) {
  const router = useRouter()
  const { colors } = useTheme()
  const { user } = useAuth()

  const reviewStepDetail =
    status === 'pending_review'
      ? 'Application submitted! Our team is reviewing it. Approvals typically take 24–48 hours.'
      : status === 'rejected'
        ? 'Please update the flagged information above and resubmit for review.'
        : 'Once all info and documents are submitted, Clemson RIDES admins will review your application.'

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text
            style={[styles.title, { color: colors.title }]}
            accessibilityRole="header"
          >
            {gate.title}
          </Text>
          <Tag label={statusBadgeLabel(status)} tone={statusBadgeTone(status)} />
        </View>
        <Text style={[styles.body, { color: colors.inkSecondary }]}>
          {gate.body}
        </Text>
        {reason && !gate.body.includes(reason.trim()) ? (
          <ErrorText>{reason}</ErrorText>
        ) : null}
      </View>

      <View style={styles.nextStepsSection}>
        <Text style={[styles.sectionTitle, { color: colors.title }]}>Next steps</Text>

        {/* 1. Finish info */}
        <Pressable
          style={[styles.stepRow, { backgroundColor: colors.track }]}
          onPress={() => router.push(user ? '/onboarding' : '/sign-in')}
          accessibilityRole="button"
          accessibilityLabel="Finish info: Complete your personal details, vehicle info, and tax information"
          accessibilityHint="Navigates to driver application"
        >
          <View style={[styles.stepIconWrap, { backgroundColor: colors.card }]}>
            <Ionicons name="create-outline" size={18} color={colors.orange} />
          </View>
          <View style={styles.stepCopy}>
            <Text style={[styles.stepTitle, { color: colors.title }]}>Finish info</Text>
            <Text style={[styles.stepDescription, { color: colors.inkSecondary }]}>
              Add personal info, vehicle, W-9, and contractor agreement.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.inkSecondary} />
        </Pressable>

        {/* 2. Upload documents */}
        <Pressable
          style={[styles.stepRow, { backgroundColor: colors.track }]}
          onPress={() => router.push('/documents')}
          accessibilityRole="button"
          accessibilityLabel="Upload documents: Submit your driver's license, insurance, and vehicle registration"
          accessibilityHint="Navigates to documents screen"
        >
          <View style={[styles.stepIconWrap, { backgroundColor: colors.card }]}>
            <Ionicons name="cloud-upload-outline" size={18} color={colors.orange} />
          </View>
          <View style={styles.stepCopy}>
            <Text style={[styles.stepTitle, { color: colors.title }]}>Upload documents</Text>
            <Text style={[styles.stepDescription, { color: colors.inkSecondary }]}>
              License, insurance, registration, and vehicle photos.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.inkSecondary} />
        </Pressable>

        {/* 3. Wait for review */}
        <View
          style={[styles.stepRow, { backgroundColor: colors.track }]}
          accessibilityRole="text"
          accessibilityLabel={`Wait for review: ${reviewStepDetail}`}
        >
          <View style={[styles.stepIconWrap, { backgroundColor: colors.card }]}>
            <Ionicons name="time-outline" size={18} color={colors.orange} />
          </View>
          <View style={styles.stepCopy}>
            <Text style={[styles.stepTitle, { color: colors.title }]}>Wait for review</Text>
            <Text style={[styles.stepDescription, { color: colors.inkSecondary }]}>
              {reviewStepDetail}
            </Text>
          </View>
        </View>

        {/* 4. Contact support */}
        <Pressable
          style={[styles.stepRow, { backgroundColor: colors.track }]}
          onPress={() => router.push('/bug-report')}
          accessibilityRole="button"
          accessibilityLabel="Contact support: Reach out to support about your application"
          accessibilityHint="Navigates to support ticket screen"
        >
          <View style={[styles.stepIconWrap, { backgroundColor: colors.card }]}>
            <Ionicons name="help-buoy-outline" size={18} color={colors.orange} />
          </View>
          <View style={styles.stepCopy}>
            <Text style={[styles.stepTitle, { color: colors.title }]}>Contact support</Text>
            <Text style={[styles.stepDescription, { color: colors.inkSecondary }]}>
              Questions about driving or your application? Contact our team.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.inkSecondary} />
        </Pressable>
      </View>

      {gate.primaryAction ? (
        <Primary
          label={gate.primaryAction}
          onPress={() => router.push(user ? '/onboarding' : '/sign-in')}
        />
      ) : null}

      {onRefresh ? (
        <Pressable
          onPress={onRefresh}
          disabled={refreshing}
          style={styles.refreshBar}
          accessibilityRole="button"
          accessibilityLabel="Refresh application status"
          accessibilityHint="Re-reads your driver onboarding status from the server"
        >
          <Ionicons name="refresh" size={14} color={colors.inkSecondary} />
          <Text style={[styles.refreshText, { color: colors.inkSecondary }]}>
            {refreshing ? 'Checking status…' : 'Pull down to refresh status'}
          </Text>
        </Pressable>
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
  },
  header: {
    gap: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    flex: 1,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
  },
  nextStepsSection: {
    gap: 8,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 14,
    gap: 10,
  },
  stepIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCopy: {
    flex: 1,
    gap: 2,
  },
  stepTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  stepDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  refreshBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 4,
  },
  refreshText: {
    fontSize: 12,
    fontWeight: '600',
  },
})

export default DriverStatusCard
