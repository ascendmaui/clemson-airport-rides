import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import {
  MAX_VEHICLE_PHOTOS,
  VEHICLE_PHOTO_BUCKET,
  VEHICLE_PHOTO_KINDS,
  listAnglePhotos,
  listProfileVehiclePhotos,
  listVehiclePhotos,
  removeVehiclePhoto,
  uploadVehiclePhoto,
} from './vehiclePhotos.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function stubFileFetch() {
  globalThis.fetch = async (url) => {
    const urlStr = String(url)
    if (urlStr.startsWith('file:') || urlStr.startsWith('blob:') || urlStr.startsWith('data:')) {
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return new Uint8Array([1, 2, 3, 4]).buffer
        },
      }
    }
    throw new Error(`unexpected fetch ${urlStr}`)
  }
}

function createPhotoStore(seed = {}) {
  const rows = [...(seed.photos || [])]
  const documents = [...(seed.documents || [])]
  const calls = { storage: [], from: [] }
  let failInsert = seed.failInsert || null

  function query(table, state) {
    calls.from.push({ table, ...state })
    if (table === 'driver_vehicle_photos' && seed.missingTable) {
      return { data: null, error: { message: "Could not find the table 'public.driver_vehicle_photos' in the schema cache" } }
    }
    if (table === 'driver_vehicle_photos' && state.operation === 'select') {
      const profileId = state.filters.find((filter) => filter.col === 'profile_id')?.val
      const data = rows.filter((row) => row.profile_id === profileId)
      return { data, error: null }
    }
    if (table === 'driver_vehicle_photos' && state.operation === 'insert') {
      if (failInsert) return { data: null, error: { message: failInsert } }
      const row = {
        id: `photo-${rows.length + 1}`,
        created_at: new Date(Date.UTC(2026, 9, rows.length + 1)).toISOString(),
        ...state.payload,
      }
      rows.push(row)
      return { data: row, error: null }
    }
    if (table === 'driver_vehicle_photos' && state.operation === 'delete') {
      const id = state.filters.find((filter) => filter.col === 'id')?.val
      const profileId = state.filters.find((filter) => filter.col === 'profile_id')?.val
      const index = rows.findIndex((row) => row.id === id && row.profile_id === profileId)
      if (index >= 0) rows.splice(index, 1)
      return { data: null, error: null }
    }
    if (table === 'driver_documents' && state.operation === 'select') {
      const profileId = state.filters.find((filter) => filter.col === 'profile_id')?.val
      return { data: documents.filter((row) => row.profile_id === profileId), error: null }
    }
    return { data: null, error: { message: `unexpected ${table} ${state.operation}` } }
  }

  function builder(table) {
    const state = { operation: 'select', filters: [], payload: null }
    const api = {
      select() {
        return api
      },
      eq(col, val) {
        state.filters.push({ col, val })
        return api
      },
      order() {
        return api
      },
      insert(payload) {
        state.operation = 'insert'
        state.payload = payload
        return api
      },
      delete() {
        state.operation = 'delete'
        return api
      },
      single() {
        return Promise.resolve(query(table, state))
      },
      then(onResolve, onReject) {
        return Promise.resolve(query(table, state)).then(onResolve, onReject)
      },
    }
    return api
  }

  const supabase = {
    from: builder,
    storage: {
      from(bucket) {
        return {
          async upload(path, bytes, options) {
            calls.storage.push({ bucket, action: 'upload', path, bytes, options })
            return { data: { path }, error: null }
          },
          async remove(paths) {
            calls.storage.push({ bucket, action: 'remove', paths })
            return { data: paths, error: null }
          },
          async createSignedUrl(path) {
            calls.storage.push({ bucket, action: 'sign', path })
            return { data: { signedUrl: `https://signed.example/${path}` }, error: null }
          },
        }
      },
    },
  }

  return { supabase, rows, calls }
}

test('vehicle photo kinds cover exterior, interior, and other', () => {
  assert.deepEqual(VEHICLE_PHOTO_KINDS.map((kind) => kind.id), ['exterior', 'interior', 'other'])
  assert.equal(VEHICLE_PHOTO_BUCKET, 'driver-documents')
})

test('uploadVehiclePhoto stores more than one photo in driver-documents', async () => {
  stubFileFetch()
  const { supabase, rows, calls } = createPhotoStore()
  const first = await uploadVehiclePhoto(supabase, 'driver-1', 'exterior', {
    uri: 'file://front.jpg',
    name: 'front.jpg',
    mimeType: 'image/jpeg',
    size: 40_000,
  })
  const second = await uploadVehiclePhoto(supabase, 'driver-1', 'interior', {
    uri: 'file://seats.png',
    name: 'seats.png',
    mimeType: 'image/png',
    size: 50_000,
  })

  assert.equal(rows.length, 2)
  assert.equal(first.kind, 'exterior')
  assert.equal(first.label, 'Exterior')
  assert.equal(first.source, 'extra')
  assert.equal(second.kind, 'interior')
  assert.match(first.storage_path, /^driver-1\/vehicle_photos\/.+\.jpg$/)
  assert.match(second.storage_path, /^driver-1\/vehicle_photos\/.+\.png$/)
  assert.notEqual(first.storage_path, second.storage_path)
  assert.equal(first.url, `https://signed.example/${first.storage_path}`)

  const uploads = calls.storage.filter((call) => call.action === 'upload')
  assert.equal(uploads.length, 2)
  assert.equal(uploads[0].bucket, 'driver-documents')
  assert.equal(uploads[1].bucket, 'driver-documents')
  assert.equal(uploads[0].options.contentType, 'image/jpeg')
  assert.equal(uploads[1].options.contentType, 'image/png')
  assert.ok(uploads[0].bytes.byteLength > 0)

  const listed = await listVehiclePhotos(supabase, 'driver-1')
  assert.equal(listed.length, 2)
  assert.deepEqual(listed.map((photo) => photo.kind), ['exterior', 'interior'])
})

test('uploadVehiclePhoto rejects a bad kind, a non-image, and an oversized file', async () => {
  const { supabase } = createPhotoStore()
  await assert.rejects(
    () => uploadVehiclePhoto(supabase, 'driver-1', 'trunk', { uri: 'file://a.jpg', mimeType: 'image/jpeg' }),
    /Choose exterior, interior, or other/,
  )
  await assert.rejects(
    () => uploadVehiclePhoto(supabase, 'driver-1', 'exterior', { uri: 'file://a.pdf', mimeType: 'application/pdf' }),
    /JPEG, PNG, WebP, or HEIC/,
  )
  await assert.rejects(
    () => uploadVehiclePhoto(supabase, 'driver-1', 'exterior', {
      uri: 'file://a.jpg',
      mimeType: 'image/jpeg',
      size: 9 * 1024 * 1024,
    }),
    /8MB or smaller/,
  )
  await assert.rejects(
    () => uploadVehiclePhoto(supabase, '', 'exterior', { uri: 'file://a.jpg', mimeType: 'image/jpeg' }),
    /Sign in required/,
  )
})

test('uploadVehiclePhoto stops at the photo cap and removes the object if the row insert fails', async () => {
  stubFileFetch()
  const seeded = Array.from({ length: MAX_VEHICLE_PHOTOS }, (_, index) => ({
    id: `seed-${index}`,
    profile_id: 'driver-1',
    storage_path: `driver-1/vehicle_photos/seed-${index}.jpg`,
    kind: 'other',
  }))
  const full = createPhotoStore({ photos: seeded })
  await assert.rejects(
    () => uploadVehiclePhoto(full.supabase, 'driver-1', 'other', {
      uri: 'file://extra.jpg',
      mimeType: 'image/jpeg',
    }),
    /up to 12 vehicle photos/,
  )
  assert.equal(full.calls.storage.filter((call) => call.action === 'upload').length, 0)

  const broken = createPhotoStore({ failInsert: 'insert rejected' })
  await assert.rejects(
    () => uploadVehiclePhoto(broken.supabase, 'driver-1', 'exterior', {
      uri: 'file://front.jpg',
      mimeType: 'image/jpeg',
    }),
    /insert rejected/,
  )
  const removed = broken.calls.storage.find((call) => call.action === 'remove')
  assert.ok(removed)
  assert.equal(removed.bucket, 'driver-documents')
  assert.equal(removed.paths.length, 1)
})

test('listVehiclePhotos returns an empty list when the table is not migrated yet', async () => {
  const { supabase } = createPhotoStore({ missingTable: true })
  const photos = await listVehiclePhotos(supabase, 'driver-1')
  assert.deepEqual(photos, [])
})

test('removeVehiclePhoto deletes the row and the stored object', async () => {
  stubFileFetch()
  const { supabase, rows, calls } = createPhotoStore()
  const saved = await uploadVehiclePhoto(supabase, 'driver-1', 'other', {
    uri: 'file://wheel.webp',
    name: 'wheel.webp',
    mimeType: 'image/webp',
  })
  assert.equal(rows.length, 1)
  await removeVehiclePhoto(supabase, 'driver-1', saved)
  assert.equal(rows.length, 0)
  const removed = calls.storage.filter((call) => call.action === 'remove')
  assert.equal(removed.at(-1).paths[0], saved.storage_path)
})

test('listProfileVehiclePhotos keeps required angle shots and extra photos together', async () => {
  stubFileFetch()
  const { supabase } = createPhotoStore({
    documents: [
      { id: 'doc-back', profile_id: 'driver-1', doc_type: 'car_back', storage_path: 'driver-1/car_back/1.jpg' },
      { id: 'doc-front', profile_id: 'driver-1', doc_type: 'car_front', storage_path: 'driver-1/car_front/1.jpg' },
      { id: 'doc-license', profile_id: 'driver-1', doc_type: 'license_front', storage_path: 'driver-1/license_front/1.jpg' },
    ],
  })
  await uploadVehiclePhoto(supabase, 'driver-1', 'interior', {
    uri: 'file://cabin.jpg',
    mimeType: 'image/jpeg',
    name: 'cabin.jpg',
  })
  const angles = await listAnglePhotos(supabase, 'driver-1')
  assert.deepEqual(angles.map((photo) => photo.label), ['Front', 'Back'])
  const profile = await listProfileVehiclePhotos(supabase, 'driver-1')
  assert.deepEqual(profile.map((photo) => photo.label), ['Front', 'Back', 'Interior'])
  assert.equal(profile[0].source, 'angle')
  assert.equal(profile[2].source, 'extra')
})
