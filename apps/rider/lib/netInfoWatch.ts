import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'
import { isOfflineSnapshot, type NetSnapshot } from '@/lib/offlineBanner'

export function snapshotFromNetInfo(state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>): NetSnapshot {
  return {
    isConnected: state.isConnected ?? null,
    isInternetReachable: state.isInternetReachable ?? null,
  }
}

/** Subscribe to NetInfo and push offline/online into the reconnect store. */
export function watchNetInfo(onOffline: (offline: boolean) => void): () => void {
  const apply = (state: NetInfoState) => {
    onOffline(isOfflineSnapshot(snapshotFromNetInfo(state)))
  }
  const unsubscribe = NetInfo.addEventListener(apply)
  NetInfo.fetch().then(apply).catch((err: unknown) => {
    console.warn('[rider] netinfo', err instanceof Error ? err.message : err)
  })
  return () => {
    unsubscribe()
  }
}
