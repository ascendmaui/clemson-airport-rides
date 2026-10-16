/**
 * Attribution required when street results are shown.
 * Geoapify free plan: "Powered by Geoapify" plus OpenStreetMap credit.
 * Photon: komoot's Photon plus OpenStreetMap credit.
 */
const linkStyle = { color: 'inherit', textDecoration: 'underline' }

export function AddressAttribution({ provider }) {
  if (provider !== 'geoapify' && provider !== 'photon') return null
  return (
    <p data-testid="address-attribution" style={{ fontSize: 11, color: 'var(--ink-tertiary)', margin: '4px 2px 0' }}>
      {provider === 'geoapify' ? (
        <a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer" style={linkStyle}>Powered by Geoapify</a>
      ) : (
        <a href="https://photon.komoot.io/" target="_blank" rel="noopener noreferrer" style={linkStyle}>Search by Photon</a>
      )}
      {' · '}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" style={linkStyle}>© OpenStreetMap contributors</a>
    </p>
  )
}
