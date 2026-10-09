import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { authedJson } from '../lib/apiClient'
import { serviceClassFromBody } from '../../shared/rideOptions.js'

export function VehicleFleetEditor({ driverId, vehicle, admin = false }) {
  const [make, setMake] = useState(vehicle?.make || '')
  const [model, setModel] = useState(vehicle?.model || '')
  const [serviceClass, setServiceClass] = useState(vehicle?.service_class === 'comfort' ? 'comfort' : 'standard')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function save() {
    setBusy(true)
    try {
      const fields = { make: make.trim(), model: model.trim(), serviceClass }
      if (!fields.make || !fields.model) throw new Error('Enter vehicle make and model.')
      const service_class = serviceClassFromBody(fields)
      if (admin) await authedJson(supabase, '/api/admin-drivers', { method: 'POST', body: { action: 'vehicle', profileId: driverId, ...fields } })
      else {
        const result = await supabase.from('vehicles').update({ make: fields.make, model: fields.model, service_class, tier: service_class }).eq('driver_id', driverId)
        if (result.error) throw new Error(result.error.message)
      }
      setMessage('Vehicle saved.')
    } catch (error) { setMessage(error.message) }
    finally { setBusy(false) }
  }
  return <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
    <label>Vehicle make<input value={make} onChange={e => setMake(e.target.value)} maxLength={80} /></label>
    <label>Vehicle model<input value={model} onChange={e => setModel(e.target.value)} maxLength={80} /></label>
    <label>Service class
      <select value={serviceClass} onChange={(e) => setServiceClass(e.target.value)}>
        <option value="standard">Standard</option>
        <option value="comfort">Extra Comfort</option>
      </select>
    </label>
    <button type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save vehicle'}</button>
    <p role="status">{message}</p>
  </div>
}
