import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { authedJson } from '../lib/apiClient'
import { isTeslaModel3 } from '../../shared/teslaFleet.js'

export function VehicleFleetEditor({ driverId, vehicle, admin = false }) {
  const [make, setMake] = useState(vehicle?.make || '')
  const [model, setModel] = useState(vehicle?.model || '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function save() {
    setBusy(true)
    try {
      const fields = { make: make.trim(), model: model.trim() }
      if (!fields.make || !fields.model) throw new Error('Enter vehicle make and model.')
      if (admin) await authedJson(supabase, '/api/admin-drivers', { method: 'POST', body: { action: 'vehicle', profileId: driverId, ...fields } })
      else {
        const tesla = isTeslaModel3(fields)
        const result = await supabase.from('vehicles').update({ ...fields, is_tesla: tesla, tier: tesla ? 'tesla' : 'standard' }).eq('driver_id', driverId)
        if (result.error) throw new Error(result.error.message)
      }
      setMessage('Vehicle saved. Tesla Model 3 rides require approval and online status.')
    } catch (error) { setMessage(error.message) }
    finally { setBusy(false) }
  }
  return <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
    <label>Vehicle make<input value={make} onChange={e => setMake(e.target.value)} maxLength={80} /></label>
    <label>Vehicle model<input value={model} onChange={e => setModel(e.target.value)} maxLength={80} /></label>
    <button type="button" disabled={busy} onClick={() => { setMake('Tesla'); setModel('Model 3') }}>Set Tesla Model 3</button>
    <button type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save vehicle'}</button>
    <p role="status">{message}</p>
  </div>
}
