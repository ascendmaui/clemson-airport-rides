/** Chunked key/value store. SecureStore items are capped near 2048 bytes; a Supabase session is larger. */

export const SECURE_CHUNK = 1800

export function createChunkedStore(backend) {
  return {
    async getItem(key) {
      const countRaw = await backend.getItem(`${key}.n`)
      if (countRaw) {
        const count = Number(countRaw)
        if (!Number.isFinite(count) || count <= 0) return null
        const parts = []
        for (let i = 0; i < count; i += 1) {
          const part = await backend.getItem(`${key}.${i}`)
          if (part == null) return null
          parts.push(part)
        }
        return parts.join('')
      }
      return backend.getItem(key)
    },
    async setItem(key, value) {
      await this.removeItem(key)
      const text = String(value)
      if (text.length <= SECURE_CHUNK) {
        await backend.setItem(key, text)
        return
      }
      const count = Math.ceil(text.length / SECURE_CHUNK)
      for (let i = 0; i < count; i += 1) {
        const slice = text.slice(i * SECURE_CHUNK, (i + 1) * SECURE_CHUNK)
        await backend.setItem(`${key}.${i}`, slice)
      }
      await backend.setItem(`${key}.n`, String(count))
    },
    async removeItem(key) {
      const countRaw = await backend.getItem(`${key}.n`)
      if (countRaw) {
        const count = Number(countRaw)
        if (Number.isFinite(count)) {
          for (let i = 0; i < count; i += 1) {
            await backend.removeItem(`${key}.${i}`)
          }
        }
        await backend.removeItem(`${key}.n`)
      }
      await backend.removeItem(key)
    },
  }
}
