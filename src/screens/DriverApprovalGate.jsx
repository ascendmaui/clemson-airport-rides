import { PrimaryButton } from '../components/PrimaryButton'
import { navigate } from '../lib/navigation'
import { onboardingLabel } from '../lib/driverOnboarding'

const COPY = {
  pending_info: {
    title: 'Finish driver signup',
    body: 'Add your info and vehicle, then upload your documents. New drivers are not approved automatically.',
  },
  pending_docs: {
    title: 'Upload your documents',
    body: 'License, insurance, registration, and car photos are required before an admin can review you.',
  },
  pending_review: {
    title: 'Application in review',
    body: 'John has your documents. You cannot go online or accept rides until the application is approved.',
  },
  rejected: {
    title: 'Application needs changes',
    body: 'Update your documents and submit again. You still cannot receive rides.',
  },
  none: {
    title: 'Become a driver',
    body: 'Create your driver profile and upload documents. An admin approves every new driver before they can receive rides.',
  },
}

export function DriverApprovalGate({ application }) {
  const status = application?.onboarding_status || 'none'
  const copy = COPY[status] || COPY.none
  return (
    <div className="fade-in" style={{ minHeight: '100%', background: 'var(--surface-muted)', padding: '28px 20px 48px' }}>
      <button type="button" className="pressable" onClick={() => navigate('account')} style={{ fontSize: 20 }}>
        ←
      </button>
      <div className="sheet" style={{ marginTop: 16, padding: 22, borderRadius: 24, boxShadow: 'var(--shadow-pill)' }}>
        <div style={{
          display: 'inline-flex',
          padding: '6px 12px',
          borderRadius: 999,
          background: 'rgba(82,45,128,0.1)',
          color: 'var(--purple)',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.2,
        }}>
          {onboardingLabel(status === 'none' ? null : status)}
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--purple)', marginTop: 12, letterSpacing: -0.4 }}>
          {copy.title}
        </h1>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 15, lineHeight: 1.5, marginTop: 8 }}>
          {copy.body}
        </p>
        {status === 'rejected' && application?.rejection_reason && (
          <div style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 14,
            background: 'rgba(217,45,32,0.08)',
            color: 'var(--danger)',
            fontSize: 14,
            lineHeight: 1.45,
          }}>
            {application.rejection_reason}
          </div>
        )}
        <div style={{ marginTop: 18 }}>
          <PrimaryButton onClick={() => navigate('driver-onboarding')}>
            {status === 'pending_review' ? 'View application' : 'Continue application'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}
