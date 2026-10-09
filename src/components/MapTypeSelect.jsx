import { MAP_TYPES } from '../lib/rideDemand'

const SELECT_STYLE = {
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0.2,
  padding: '7px 30px 7px 10px',
  borderRadius: 12,
  border: '1px solid rgba(82,45,128,0.35)',
  background:
    '#fff url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 12 12%27%3E%3Cpath fill=%27%23522D80%27 d=%27M3 4.5L6 8l3-3.5%27/%3E%3C/svg%3E") no-repeat right 10px center',
  color: '#522D80',
  boxShadow: '0 2px 10px rgba(11,18,32,0.22)',
  cursor: 'pointer',
  minWidth: 108,
  maxWidth: 148,
}

export function MapTypeSelect({ value, onChange }) {
  const resolved = value === 'satellite' || value === 'hybrid' ? value : 'roadmap'
  return (
    <label className="map-type-select">
      <span className="sr-only">Map type</span>
      <select
        aria-label="Map type"
        value={resolved}
        onChange={(e) => onChange?.(e.target.value)}
        style={SELECT_STYLE}
      >
        {MAP_TYPES.map((mt) => (
          <option key={mt.id} value={mt.id}>
            {mt.label}
          </option>
        ))}
      </select>
    </label>
  )
}
