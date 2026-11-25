/**
 * Pluggable registrar / enrollment check. NO vendor is connected. The only
 * provider is 'manual': the request lands as status 'pending' and an admin
 * approves or rejects it. A future vendor (NSC, SheerID) implements the same
 * { name, check(enrollment) } shape and is selected by REGISTRAR_PROVIDER.
 */
export const manualProvider = {
  name: 'manual',
  async check() {
    return { status: 'pending', method: 'manual', vendorRef: null, raw: null }
  },
}

const PROVIDERS = { manual: manualProvider }

export function registerRegistrarProvider(name, provider) {
  if (!provider || typeof provider.check !== 'function') throw new Error('provider needs check()')
  PROVIDERS[name] = { name, ...provider }
}

export function registrarProvider(env = process.env) {
  const want = String(env.REGISTRAR_PROVIDER || 'manual').trim().toLowerCase()
  return PROVIDERS[want] || manualProvider
}
