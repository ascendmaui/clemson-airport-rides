/* Driver-only Web Push worker. Riders do not register this script. */
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'You were assigned to a ride', body: event.data ? event.data.text() : '' }
  }
  const title = payload.title || 'You were assigned to a ride'
  const body = payload.body || 'This ride is assigned to you.'
  event.waitUntil(self.registration.showNotification(title, {
    body,
    data: { tripId: payload.tripId || null, kind: payload.kind || 'ride_assigned' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = '/#/driver'
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (client.url && 'focus' in client) return client.focus()
    }
    if (self.clients.openWindow) return self.clients.openWindow(target)
    return undefined
  }))
})
