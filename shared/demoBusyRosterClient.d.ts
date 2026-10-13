export function createAppConfigLoader(): (url: string, fetcher?: typeof fetch) => Promise<boolean | undefined>
export function readWebDemoBusyRosterOverride(location: { search?: string; hash?: string }, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): boolean | undefined
