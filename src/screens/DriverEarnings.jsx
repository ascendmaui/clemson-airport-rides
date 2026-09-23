import { useEffect, useMemo, useState } from 'react'
import { EarningsAreaMap } from '../components/EarningsAreaMap'
import { useAuth } from '../lib/auth'
import {
  annualTaxCsvFilename,
  buildAnnualTaxCsv,
  buildAnnualTaxSummary,
  earningsProgressCopy,
  fetchDriverEarningsReport,
  formatDuration,
  formatMiles,
  formatTripWhen,
  localTimeZone,
  taxYears,
  TAX_DISCLAIMER,
} from '../lib/driverEarnings'
import { navigate, getHashRoute } from '../lib/navigation'
import { formatUsdFromCents } from '../lib/pricing'

const money = (cents) => formatUsdFromCents(cents || 0)

function Stat({ label, value, hint, testId }) {
  return (
    <div className="glass-panel" style={{ padding: '12px 14px', borderRadius: 16, minWidth: 0 }} data-testid={testId}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-tertiary)' }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 22, fontWeight: 800, letterSpacing: -0.4, color: 'var(--ink)' }}>{value}</div>
      {hint ? <div style={{ marginTop: 2, fontSize: 12, color: 'var(--ink-secondary)' }}>{hint}</div> : null}
    </div>
  )
}

function Line({ label, value, strong, hint }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: '1px solid rgba(82,45,128,0.08)' }}>
      <div style={{ fontSize: 13, color: strong ? 'var(--purple)' : 'var(--ink-secondary)', fontWeight: strong ? 800 : 600 }}>
        {label}
        {hint ? <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink-tertiary)' }}>{hint}</div> : null}
      </div>
      <div style={{ fontSize: strong ? 16 : 14, fontWeight: 800, color: strong ? 'var(--purple)' : 'var(--ink)', textAlign: 'right' }}>{value}</div>
    </div>
  )
}

function trackedMoney(cents) {
  if (cents == null) return 'Not tracked'
  return money(cents)
}

function downloadCsv(summary) {
  const csv = buildAnnualTaxCsv(summary)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = annualTaxCsvFilename(summary.year)
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function TripDetail({ trip }) {
  return (
    <div style={{ marginTop: 10, paddingTop: 4 }} data-testid="trip-breakdown">
      <Line label="Fare" value={money(trip.fareCents)} />
      {trip.refundCents > 0 ? <Line label="Refund" value={`−${money(trip.refundCents)}`} /> : null}
      {trip.tipCents != null ? <Line label="Tip" value={money(trip.tipCents)} /> : null}
      {trip.waitFeeCents != null ? <Line label="Wait fee" value={money(trip.waitFeeCents)} /> : null}
      {trip.cancelFeeCents != null ? <Line label="Cancel fee" value={money(trip.cancelFeeCents)} /> : null}
      <Line label="Gross" value={money(trip.grossCents)} />
      <Line label="Platform fee" value={`−${money(trip.platformFeeCents)}`} hint="20% of fares, tips, wait, and cancel fees" />
      <Line label="Your net" value={money(trip.earnedCents)} hint="80%" strong />
      <Line label="Distance" value={formatMiles(trip.distanceM, { approximate: trip.distanceApproximate })} />
      <Line label="Duration" value={formatDuration(trip.durationS, { approximate: trip.durationApproximate })} />
      {trip.fareParts?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-tertiary)', textTransform: 'uppercase' }}>Included in the fare</div>
          {trip.fareParts.map((part) => (
            <Line key={part.label} label={part.label} value={money(part.cents)} />
          ))}
        </div>
      )}
      {trip.riderFirstName ? (
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-secondary)' }}>Rider · {trip.riderFirstName}</div>
      ) : null}
      <div style={{ marginTop: 12 }}>
        <EarningsAreaMap pickup={trip.pickupApprox} dropoff={trip.dropoffApprox} />
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-tertiary)' }}>
          Pins show the neighborhood, not the exact stop.
        </div>
      </div>
    </div>
  )
}

export function DriverEarningsView({
  summary,
  trips,
  year,
  years,
  onYear,
  loading,
  error,
  timeZone,
}) {
  const [openId, setOpenId] = useState(null)
  const tax = useMemo(
    () => buildAnnualTaxSummary(trips, { year, timeZone }),
    [trips, year, timeZone],
  )
  const maxDay = Math.max(...summary.days.map((day) => day.earningsCents), 1)
  const progress = earningsProgressCopy(summary)

  return (
    <div style={{ minHeight: '100%', overflowY: 'auto', background: 'linear-gradient(180deg, rgba(245,102,0,0.1), rgba(82,45,128,0.06) 32%, #f7f5f8)' }}>
      <div className="no-print" style={{ padding: '18px 18px 28px', maxWidth: 560, margin: '0 auto' }}>
        <button
          type="button"
          className="pressable"
          onClick={() => navigate('driver')}
          style={{ fontWeight: 700, color: 'var(--purple)', marginBottom: 14 }}
        >
          ← Driver
        </button>

        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--orange)', letterSpacing: 0.3 }}>Your net</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.6, color: 'var(--purple)', marginTop: 2 }}>Earnings</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 4, lineHeight: 1.45 }}>
          Your 80% after the 20% platform fee on fares, tips, wait, and cancel fees.
        </p>

        {error ? (
          <p role="alert" style={{ marginTop: 12, color: 'var(--danger)', fontWeight: 600, fontSize: 13 }}>{error}</p>
        ) : null}

        <div className="glass-panel glass-panel--orange" style={{ marginTop: 16, padding: 18, borderRadius: 22 }} data-testid="week-summary">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-tertiary)', textTransform: 'uppercase' }}>This week</div>
              <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1, color: 'var(--orange)', lineHeight: 1.05 }} data-testid="week-net">
                {loading ? '…' : money(summary.weekEarningsCents)}
              </div>
              <div style={{ marginTop: 6, fontSize: 13, color: 'var(--ink-secondary)' }}>
                {summary.weekTripCount} {summary.weekTripCount === 1 ? 'trip' : 'trips'}
                {summary.weekTipsCents != null ? ` · Tips ${money(summary.weekTipsCents)}` : ''}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-tertiary)' }}>
                Gross {money(summary.weekGrossCents)} · platform cut {money(summary.weekPlatformFeeCents)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--purple)', background: 'rgba(82,45,128,0.1)', borderRadius: 999, padding: '4px 8px' }}>
                Estimate
              </div>
              <div style={{ marginTop: 8, fontSize: 20, fontWeight: 800, color: 'var(--purple)' }} data-testid="week-projected">
                {money(summary.projectedWeekCents)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>
                {summary.remainingDays > 0 ? `${money(summary.projectedRemainderCents)} still ahead` : 'Week is in'}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 14, height: 8, borderRadius: 999, background: 'rgba(82,45,128,0.1)', overflow: 'hidden' }}>
            <div style={{ width: `${(summary.elapsedDays / 7) * 100}%`, height: '100%', background: 'linear-gradient(90deg, var(--orange), var(--purple))' }} />
          </div>
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.4 }}>{progress}</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }} data-testid="daily-summary">
          <Stat label="Today" value={money(summary.todayEarningsCents)} hint={summary.todayTipsCents != null ? `Tips ${money(summary.todayTipsCents)}` : 'Net after fee'} testId="today-net" />
          <Stat label="Trips today" value={String(summary.todayTripCount)} hint="Completed" />
        </div>

        <div className="glass-panel" style={{ marginTop: 12, padding: '14px 12px 10px', borderRadius: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--purple)', padding: '0 4px 8px' }}>This week, by day</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
            {summary.days.map((day) => (
              <div key={day.label} style={{ textAlign: 'center', opacity: day.isFuture ? 0.45 : 1 }}>
                <div style={{ height: 56, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                  <div
                    style={{
                      width: '70%',
                      height: day.earningsCents > 0 ? `${Math.max(12, (day.earningsCents / maxDay) * 56)}px` : 4,
                      borderRadius: 999,
                      background: day.isToday ? 'var(--orange)' : 'var(--purple)',
                    }}
                  />
                </div>
                <div style={{ marginTop: 6, fontSize: 11, fontWeight: 800, color: day.isToday ? 'var(--orange)' : 'var(--purple)' }}>{day.label}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink)' }}>{day.earningsCents ? money(day.earningsCents).replace(/\.00$/, '') : '—'}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--purple)' }}>Rides</h2>
          <span style={{ fontSize: 12, color: 'var(--ink-tertiary)' }}>Newest first</span>
        </div>
        <div style={{ marginTop: 8, maxHeight: '52vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="ride-list">
          {summary.rides.length === 0 && !loading ? (
            <div className="glass-panel" style={{ padding: 16, borderRadius: 16, color: 'var(--ink-secondary)', fontSize: 14 }}>
              Completed trips show up here.
            </div>
          ) : null}
          {summary.rides.map((trip) => {
            const open = openId === trip.id
            return (
              <div key={trip.id} className="glass-panel" style={{ borderRadius: 16, padding: '12px 14px' }}>
                <button
                  type="button"
                  className="pressable"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : trip.id)}
                  style={{ width: '100%', textAlign: 'left' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontSize: 12, color: 'var(--ink-tertiary)', fontWeight: 700 }}>{formatTripWhen(trip.completedAt, timeZone)}</span>
                    <strong style={{ color: 'var(--orange)' }}>{money(trip.earnedCents)}</strong>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                    {trip.status === 'canceled' ? 'Canceled · ' : ''}{trip.routeLabel}
                  </div>
                  {trip.riderFirstName ? (
                    <div style={{ marginTop: 2, fontSize: 12, color: 'var(--ink-secondary)' }}>{trip.riderFirstName}</div>
                  ) : null}
                </button>
                {open ? <TripDetail trip={trip} /> : null}
              </div>
            )
          })}
        </div>

        <TaxSummary
          tax={{ ...tax, capped: trips.length >= 1000 }}
          years={years}
          year={year}
          onYear={onYear}
          onDownload={() => downloadCsv(tax)}
        />
      </div>
      <TaxPrintSheet tax={tax} timeZone={timeZone} />
    </div>
  )
}

function TaxSummary({ tax, years, year, onYear, onDownload }) {
  return (
    <section id="tax-summary" className="glass-panel glass-panel--purple" style={{ marginTop: 22, padding: 16, borderRadius: 22 }} data-testid="tax-summary">
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--orange)' }}>Year-end</div>
      <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--purple)', marginTop: 4 }}>Tax summary</h2>
      <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 4, lineHeight: 1.45 }}>
        A yearly snapshot of your net, tips, and the 20% platform fee.
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {years.map((item) => (
          <button
            key={item}
            type="button"
            className="pressable"
            onClick={() => onYear(item)}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              fontWeight: 800,
              fontSize: 13,
              color: item === year ? '#fff' : 'var(--purple)',
              background: item === year ? 'var(--purple)' : 'rgba(255,255,255,0.7)',
            }}
          >
            {item}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 8 }}>
        <Line label="Gross fares" value={money(tax.grossFareCents)} />
        {tax.refundCents > 0 ? <Line label="Refunds" value={`−${money(tax.refundCents)}`} /> : null}
        <Line label="Tips" value={trackedMoney(tax.tipsCents)} />
        <Line label="Wait fees" value={trackedMoney(tax.waitFeeCents)} />
        <Line label="Cancel fees" value={trackedMoney(tax.cancelFeeCents)} />
        <Line label="Gross" value={money(tax.grossCents)} />
        <Line label="Platform fees" value={`−${money(tax.platformFeeCents)}`} hint="20% of fares, tips, wait, and cancel fees" />
        <Line label="Driver net" value={money(tax.driverNetCents)} hint="80%" strong />
        <Line label="Trips" value={String(tax.tripCount)} />
      </div>
      <p style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-secondary)', lineHeight: 1.45 }} data-testid="tax-disclaimer">
        {TAX_DISCLAIMER}
      </p>
      {tax.capped ? (
        <p style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-tertiary)' }}>
          Based on your 1,000 most recent completed trips.
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button
          type="button"
          className="pressable"
          onClick={onDownload}
          style={{ flex: 1, padding: 12, borderRadius: 14, fontWeight: 800, color: '#fff', background: 'linear-gradient(135deg, var(--orange), #ff7a1a)' }}
        >
          Download CSV
        </button>
        <button
          type="button"
          className="pressable"
          onClick={() => window.print()}
          style={{ flex: 1, padding: 12, borderRadius: 14, fontWeight: 800, color: 'var(--purple)', background: 'rgba(255,255,255,0.72)', border: '1.5px solid rgba(82,45,128,0.25)' }}
        >
          Print
        </button>
      </div>
    </section>
  )
}

function TaxPrintSheet({ tax, timeZone }) {
  return (
    <article className="tax-print-sheet" aria-hidden="true">
      <h1>Clemson RIDES · {tax.year} driver earnings summary</h1>
      <p>{tax.disclaimer}</p>
      <p>Timezone: {timeZone}. Platform fee is 20% of fares, tips, wait fees, and cancel fees. Driver net is the remaining 80%.</p>
      <table>
        <tbody>
          <tr><th>Gross fares</th><td>{money(tax.grossFareCents)}</td></tr>
          <tr><th>Refunds</th><td>{money(tax.refundCents)}</td></tr>
          <tr><th>Tips</th><td>{trackedMoney(tax.tipsCents)}</td></tr>
          <tr><th>Wait fees</th><td>{trackedMoney(tax.waitFeeCents)}</td></tr>
          <tr><th>Cancel fees</th><td>{trackedMoney(tax.cancelFeeCents)}</td></tr>
          <tr><th>Gross</th><td>{money(tax.grossCents)}</td></tr>
          <tr><th>Platform fees (20%)</th><td>{money(tax.platformFeeCents)}</td></tr>
          <tr><th>Driver net (80%)</th><td>{money(tax.driverNetCents)}</td></tr>
          <tr><th>Trip count</th><td>{tax.tripCount}</td></tr>
        </tbody>
      </table>
      <h2>Trips</h2>
      <table>
        <thead>
          <tr><th>When</th><th>Rider</th><th>Area</th><th>Net</th></tr>
        </thead>
        <tbody>
          {tax.trips.map((trip) => (
            <tr key={trip.id || trip.completedAt}>
              <td>{formatTripWhen(trip.completedAt, timeZone)}</td>
              <td>{trip.riderFirstName || ''}</td>
              <td>{trip.routeLabel}</td>
              <td>{money(trip.earnedCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  )
}

export function DriverEarnings() {
  const { user, loading: authLoading } = useAuth()
  const timeZone = useMemo(() => localTimeZone(), [])
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [year, setYear] = useState(() => new Date().getFullYear())

  useEffect(() => {
    if (authLoading) return undefined
    if (!user?.id) return undefined
    let alive = true
    setLoading(true)
    fetchDriverEarningsReport(user.id, { timeZone })
      .then((next) => {
        if (!alive) return
        setReport(next)
        const years = taxYears(next.trips, new Date(), timeZone)
        setYear(years[0])
        setError(null)
      })
      .catch((err) => {
        if (!alive) return
        setError(err.message || 'Could not load earnings')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [user?.id, authLoading, timeZone])

  useEffect(() => {
    if (loading || getHashRoute().params.doc !== 'tax') return undefined
    const node = document.getElementById('tax-summary')
    node?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return undefined
  }, [loading, year])

  const trips = report?.trips || []
  const years = taxYears(trips, new Date(), timeZone)
  const summary = report?.summary || {
    weekEarningsCents: 0,
    weekGrossCents: 0,
    weekPlatformFeeCents: 0,
    weekTripCount: 0,
    weekTipsCents: null,
    todayEarningsCents: 0,
    todayTripCount: 0,
    todayTipsCents: null,
    projectedWeekCents: 0,
    projectedRemainderCents: 0,
    remainingDays: 0,
    elapsedDays: 1,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, index) => ({
      label,
      index,
      earningsCents: 0,
      tripCount: 0,
      isToday: false,
      isFuture: false,
    })),
    rides: [],
    paceSource: 'no_recent_trips',
  }

  return (
    <DriverEarningsView
      summary={summary}
      trips={trips}
      year={year}
      years={years}
      onYear={setYear}
      loading={loading || authLoading}
      error={error}
      timeZone={timeZone}
    />
  )
}
