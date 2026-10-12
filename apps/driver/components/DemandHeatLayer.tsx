import { memo } from 'react'
import { Polygon } from 'react-native-maps'
import { cellRing, heatLayers, type DemandCell } from 'rides-native/demandHeat.js'

const HALO_LIMIT = 18

/**
 * Stacked soft-square rings per grid cell (halo → body → core) give a
 * gradient look without a native heatmap. The core ring is tappable.
 * Halos drop when many cells are on screen to keep overlay count low.
 */
function Cell({ cell, scheme, halo, onPress }: { cell: DemandCell; scheme: 'light' | 'dark'; halo: boolean; onPress?: (cell: DemandCell) => void }) {
  const colors = heatLayers(cell.intensity, scheme)
  const coreScale = 0.42 + 0.32 * cell.intensity
  return (
    <>
      {halo ? (
        <Polygon coordinates={cellRing(cell, 1.6)} fillColor={colors.halo} strokeWidth={0} strokeColor="transparent" zIndex={1} />
      ) : null}
      <Polygon coordinates={cellRing(cell, 1.0)} fillColor={colors.body} strokeWidth={0} strokeColor="transparent" zIndex={2} />
      <Polygon
        coordinates={cellRing(cell, coreScale)}
        fillColor={colors.core}
        strokeColor={colors.stroke}
        strokeWidth={cell.intensity >= 0.85 ? 1 : 0}
        zIndex={3}
        tappable
        onPress={() => onPress?.(cell)}
      />
    </>
  )
}

const MemoCell = memo(Cell, (a, b) => a.cell.id === b.cell.id && a.cell.intensity === b.cell.intensity && a.scheme === b.scheme && a.halo === b.halo)

export function DemandHeatLayer({ cells, scheme, onPress }: { cells: DemandCell[]; scheme: 'light' | 'dark'; onPress?: (cell: DemandCell) => void }) {
  const halo = cells.length <= HALO_LIMIT
  return (
    <>
      {cells.map((cell) => (
        <MemoCell key={`heat-${cell.id}`} cell={cell} scheme={scheme} halo={halo} onPress={onPress} />
      ))}
    </>
  )
}
