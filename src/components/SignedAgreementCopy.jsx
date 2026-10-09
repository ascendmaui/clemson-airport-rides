import { useEffect, useState } from 'react'
import { fetchMyAgreement } from '../lib/driverOnboarding'

export function SignedAgreementCopy({ userId }) {
  const [row, setRow] = useState(null)

  useEffect(() => {
    if (!userId) return undefined
    let alive = true
    fetchMyAgreement(userId)
      .then((data) => {
        if (alive) setRow(data)
      })
      .catch(() => {
        if (alive) setRow(null)
      })
    return () => {
      alive = false
    }
  }, [userId])

  if (!row?.html_snapshot) return null
  return (
    <section style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 16, color: 'var(--purple)', marginBottom: 6 }}>Signed contractor agreement</h2>
      <p style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
        Signed by {row.signature_name} on {new Date(row.signed_at).toLocaleString()} · {row.agreement_version}
      </p>
      <div
        style={{
          maxHeight: 240,
          overflow: 'auto',
          padding: 12,
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'white',
          fontSize: 13,
          lineHeight: 1.45,
        }}
        dangerouslySetInnerHTML={{ __html: row.html_snapshot }}
      />
    </section>
  )
}
