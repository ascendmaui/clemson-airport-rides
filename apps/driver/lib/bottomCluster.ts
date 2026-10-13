/** Distance the bottom cluster travels when the driver taps END. */
export const BOTTOM_CLUSTER_SHIFT = 120

export type ShiftControl = 'END' | 'GO'

/** One translate for the bar, the GO button, and the side icons. */
export type ClusterTranslate = {
  translateY: number
  bar: number
  go: number
  sideIcons: number
}

/** Online rests the cluster. END (offline) slides the whole cluster down. */
export function bottomClusterTranslateY(online: boolean): number {
  return online ? 0 : BOTTOM_CLUSTER_SHIFT
}

function clusterFrame(online: boolean): ClusterTranslate {
  const translateY = bottomClusterTranslateY(online)
  return { translateY, bar: translateY, go: translateY, sideIcons: translateY }
}

/**
 * END and GO flip one online flag. Every piece of the bottom cluster reads that
 * same translate, so the bar, GO button, and side icons cannot drift apart.
 */
export function createBottomCluster(online = true) {
  let current = online
  return {
    tap(control: ShiftControl): ClusterTranslate {
      switch (control) {
        case 'END':
          current = false
          break
        case 'GO':
          current = true
          break
        default: {
          const unknown: never = control
          return unknown
        }
      }
      return clusterFrame(current)
    },
  }
}
