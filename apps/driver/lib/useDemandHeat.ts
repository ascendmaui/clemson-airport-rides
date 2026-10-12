import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { supabase } from '@/lib/supabase'
import { quantize, subscribeDemandCells, tweenCells, type DemandCell } from 'rides-native/demandHeat.js'

const TWEEN_MS = 700
const TWEEN_FRAMES = 8

/**
 * Live Tiger Heat cells for the driver map: 30 s poll + realtime nudges,
 * with a short, frame-capped fade between snapshots so the heat breathes
 * instead of popping. Frames are quantized so native overlays only update
 * when the color visibly changes (cheap on older iPhones).
 */
export function useDemandHeat({ enabled, peak }: { enabled: boolean; peak: boolean }) {
  const [cells, setCells] = useState<DemandCell[]>([])
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shown = useRef<DemandCell[]>([])
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!enabled || !supabase) {
      shown.current = []
      setCells([])
      return undefined
    }
    const stop = subscribeDemandCells(supabase, {
      peak,
      appState: AppState,
      onData: (result) => {
        if (!result.cells) {
          setError(result.error)
          return
        }
        setError(result.error)
        setUpdatedAt(result.at)
        const from = shown.current
        const to = result.cells
        if (timer.current) clearInterval(timer.current)
        let frame = 0
        timer.current = setInterval(() => {
          frame += 1
          const t = frame / TWEEN_FRAMES
          const next = tweenCells(from, to, t).map((cell) => ({ ...cell, intensity: quantize(cell.intensity) }))
          shown.current = t >= 1 ? to : next
          setCells(next)
          if (frame >= TWEEN_FRAMES && timer.current) {
            clearInterval(timer.current)
            timer.current = null
          }
        }, TWEEN_MS / TWEEN_FRAMES)
      },
    })
    return () => {
      stop()
      if (timer.current) clearInterval(timer.current)
      timer.current = null
    }
  }, [enabled, peak])

  return { cells, updatedAt, error }
}
