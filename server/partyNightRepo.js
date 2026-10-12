/**
 * Storage for party nights. Memory repo is for tests. Supabase repo is the live path.
 * Service role writes. Riders do not insert these rows from the browser.
 */

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

export function createMemoryPartyRepo() {
  const nights = []
  const members = []
  const queue = []

  return {
    async insertNight(row) {
      nights.push(clone(row))
      return clone(row)
    },
    async updateNight(id, patch) {
      const row = nights.find((night) => night.id === id)
      if (!row) return null
      Object.assign(row, patch, { updatedAt: patch.updatedAt || new Date().toISOString() })
      return clone(row)
    },
    async nightByToken(token) {
      const row = nights.find((night) => night.token === token)
      return row ? clone(row) : null
    },
    async nightById(id) {
      const row = nights.find((night) => night.id === id)
      return row ? clone(row) : null
    },
    async membersOf(nightId) {
      return members
        .filter((member) => member.partyNightId === nightId)
        .sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt))
        .map(clone)
    },
    async insertMember(row) {
      members.push(clone(row))
      return clone(row)
    },
    async saveMemberShares(rows) {
      for (const next of rows) {
        const row = members.find((member) => member.id === next.id)
        if (!row) continue
        row.shareCents = next.shareCents
        row.holdCents = next.holdCents
        row.bufferCents = next.bufferCents
        row.holdKind = 'preauth'
      }
    },
    async deleteMember(id) {
      const index = members.findIndex((member) => member.id === id)
      if (index >= 0) members.splice(index, 1)
    },
    async nightsForUser(userId) {
      const ids = new Set(members.filter((member) => member.userId === userId).map((member) => member.partyNightId))
      return nights
        .filter((night) => night.organizerId === userId || ids.has(night.id))
        .map(clone)
    },
    async waitingReturns() {
      return queue.filter((entry) => entry.status === 'waiting').map(clone)
    },
    async upsertWaitingReturn(row) {
      const existing = queue.find((entry) => entry.riderId === row.riderId && entry.status === 'waiting')
      if (existing) {
        existing.pickup = row.pickup
        existing.dropoff = row.dropoff
        existing.partyNightId = row.partyNightId || null
        existing.displayName = row.displayName
        return clone(existing)
      }
      const created = { ...clone(row), status: 'waiting' }
      queue.push(created)
      return clone(created)
    },
    async leaveReturn(riderId) {
      for (const entry of queue) {
        if (entry.riderId === riderId && entry.status === 'waiting') entry.status = 'left'
      }
    },
  }
}

function nightFromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    organizerId: row.organizer_id,
    token: row.token,
    status: row.status,
    pickup: { label: row.pickup_label, lat: row.pickup_lat, lng: row.pickup_lng },
    dropoff: { label: row.dropoff_label, lat: row.dropoff_lat, lng: row.dropoff_lng },
    pickupAt: row.pickup_at,
    estimatedFareCents: row.estimated_fare_cents,
    returnOptIn: Boolean(row.return_opt_in),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function nightToRow(night) {
  return {
    id: night.id,
    organizer_id: night.organizerId,
    token: night.token,
    status: night.status,
    pickup_label: night.pickup.label,
    pickup_lat: night.pickup.lat,
    pickup_lng: night.pickup.lng,
    dropoff_label: night.dropoff.label,
    dropoff_lat: night.dropoff.lat,
    dropoff_lng: night.dropoff.lng,
    pickup_at: night.pickupAt,
    estimated_fare_cents: night.estimatedFareCents,
    return_opt_in: Boolean(night.returnOptIn),
    created_at: night.createdAt,
    updated_at: night.updatedAt || night.createdAt,
  }
}

function memberFromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    partyNightId: row.party_night_id,
    userId: row.user_id,
    displayName: row.display_name,
    shareCents: row.share_cents,
    holdCents: row.hold_cents,
    bufferCents: row.buffer_cents,
    holdKind: row.hold_kind,
    joinedAt: row.joined_at,
  }
}

function memberToRow(member) {
  return {
    id: member.id,
    party_night_id: member.partyNightId,
    user_id: member.userId,
    display_name: member.displayName,
    share_cents: member.shareCents,
    hold_cents: member.holdCents,
    buffer_cents: member.bufferCents,
    hold_kind: 'preauth',
    joined_at: member.joinedAt,
  }
}

function returnFromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    riderId: row.rider_id,
    partyNightId: row.party_night_id,
    displayName: row.display_name,
    pickup: { label: row.pickup_label, lat: row.pickup_lat, lng: row.pickup_lng },
    dropoff: {
      label: row.dropoff_label,
      lat: row.dropoff_lat,
      lng: row.dropoff_lng,
    },
    status: row.status,
    joinedAt: row.joined_at,
  }
}

function throwIf(error) {
  if (error) throw new Error(error.message || 'Party night save failed')
}

export function supabasePartyRepo(sb) {
  return {
    async insertNight(night) {
      const { data, error } = await sb.from('party_nights').insert(nightToRow(night)).select('*').single()
      throwIf(error)
      return nightFromRow(data)
    },
    async updateNight(id, patch) {
      const row = {}
      if (patch.status) row.status = patch.status
      if (patch.updatedAt) row.updated_at = patch.updatedAt
      else row.updated_at = new Date().toISOString()
      const { data, error } = await sb.from('party_nights').update(row).eq('id', id).select('*').single()
      throwIf(error)
      return nightFromRow(data)
    },
    async nightByToken(token) {
      const { data, error } = await sb.from('party_nights').select('*').eq('token', token).maybeSingle()
      throwIf(error)
      return nightFromRow(data)
    },
    async nightById(id) {
      const { data, error } = await sb.from('party_nights').select('*').eq('id', id).maybeSingle()
      throwIf(error)
      return nightFromRow(data)
    },
    async membersOf(nightId) {
      const { data, error } = await sb.from('party_night_members').select('*').eq('party_night_id', nightId).order('joined_at', { ascending: true })
      throwIf(error)
      return (data || []).map(memberFromRow)
    },
    async insertMember(member) {
      const { data, error } = await sb.from('party_night_members').insert(memberToRow(member)).select('*').single()
      throwIf(error)
      return memberFromRow(data)
    },
    async saveMemberShares(rows) {
      for (const member of rows) {
        const { error } = await sb.from('party_night_members').update({
          share_cents: member.shareCents,
          hold_cents: member.holdCents,
          buffer_cents: member.bufferCents,
          hold_kind: 'preauth',
        }).eq('id', member.id)
        throwIf(error)
      }
    },
    async deleteMember(id) {
      const { error } = await sb.from('party_night_members').delete().eq('id', id)
      throwIf(error)
    },
    async nightsForUser(userId) {
      const owned = await sb.from('party_nights').select('*').eq('organizer_id', userId)
      throwIf(owned.error)
      const membership = await sb.from('party_night_members').select('party_night_id').eq('user_id', userId)
      throwIf(membership.error)
      const known = new Set((owned.data || []).map((row) => row.id))
      const extraIds = [...new Set((membership.data || []).map((row) => row.party_night_id))].filter((id) => !known.has(id))
      let extra = []
      if (extraIds.length) {
        const more = await sb.from('party_nights').select('*').in('id', extraIds)
        throwIf(more.error)
        extra = more.data || []
      }
      return [...(owned.data || []), ...extra].map(nightFromRow)
    },
    async waitingReturns() {
      const { data, error } = await sb.from('party_return_queue').select('*').eq('status', 'waiting').order('joined_at', { ascending: true })
      throwIf(error)
      return (data || []).map(returnFromRow)
    },
    async upsertWaitingReturn(row) {
      const existing = await sb.from('party_return_queue').select('*').eq('rider_id', row.riderId).eq('status', 'waiting').maybeSingle()
      throwIf(existing.error)
      const payload = {
        rider_id: row.riderId,
        party_night_id: row.partyNightId || null,
        display_name: row.displayName,
        pickup_label: row.pickup.label,
        pickup_lat: row.pickup.lat,
        pickup_lng: row.pickup.lng,
        dropoff_label: row.dropoff?.label || null,
        dropoff_lat: row.dropoff?.lat ?? null,
        dropoff_lng: row.dropoff?.lng ?? null,
        status: 'waiting',
      }
      if (existing.data) {
        const { data, error } = await sb.from('party_return_queue').update(payload).eq('id', existing.data.id).select('*').single()
        throwIf(error)
        return returnFromRow(data)
      }
      const { data, error } = await sb.from('party_return_queue').insert({
        ...payload,
        id: row.id,
        joined_at: row.joinedAt,
      }).select('*').single()
      throwIf(error)
      return returnFromRow(data)
    },
    async leaveReturn(riderId) {
      const { error } = await sb.from('party_return_queue').update({ status: 'left' }).eq('rider_id', riderId).eq('status', 'waiting')
      throwIf(error)
    },
  }
}
