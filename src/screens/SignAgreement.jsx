import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { PrimaryButton } from '../components/PrimaryButton'
import { navigate } from '../lib/navigation'
import { fetchAgreementToSign, signAgreementWithToken } from '../lib/driverOnboarding'

export function SignAgreement({ token = '' }) {
  const { user, loading } = useAuth()
  const [packet, setPacket] = useState(null)
  const [name, setName] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [signed, setSigned] = useState(null)

  useEffect(() => {
    if (loading || !user?.id || !token) return undefined
    let alive = true
    fetchAgreementToSign(token)
      .then((data) => {
        if (alive) setPacket(data)
      })
      .catch((err) => {
        if (alive) setError(err.message || String(err))
      })
    return () => {
      alive = false
    }
  }, [loading, user, token])

  async function onSign(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const data = await signAgreementWithToken({
        token,
        signatureName: name.trim(),
        accepted,
      })
      setSigned(data)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return <p style={{ padding: 24 }}>This signing link is not valid.</p>
  }

  return (
    <div style={{ padding: '24px 20px 48px', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--purple)' }}>Sign contractor agreement</h1>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {signed ? (
        <>
          <p style={{ color: 'var(--purple)', fontWeight: 700 }}>
            Signed by {signed.signature_name} on {new Date(signed.signed_at).toLocaleString()}.
          </p>
          <AgreementHtml html={signed.html_snapshot} />
          <PrimaryButton onClick={() => navigate('account')}>Back to account</PrimaryButton>
        </>
      ) : (
        <>
          <AgreementHtml html={packet?.html_snapshot} />
          <form onSubmit={onSign}>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '16px 0', fontSize: 14 }}>
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              <span>I have read this agreement and I agree to it.</span>
            </label>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 650 }}>
              Type your legal name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: 6, padding: 12, borderRadius: 12, border: '1px solid var(--border)' }}
              />
            </label>
            <div style={{ marginTop: 16 }}>
              <PrimaryButton type="submit" disabled={busy || !accepted || name.trim().length < 2 || !packet}>
                {busy ? 'Signing…' : 'Sign agreement'}
              </PrimaryButton>
            </div>
          </form>
        </>
      )}
    </div>
  )
}

function AgreementHtml({ html }) {
  if (!html) return null
  return (
    <div
      style={{
        maxHeight: 360,
        overflow: 'auto',
        marginTop: 12,
        padding: 12,
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'white',
        fontSize: 13,
        lineHeight: 1.45,
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
