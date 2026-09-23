/**
 * Single shared Google Maps JS loader for the whole app.
 * CampusMap (Circles heat) + PlacePicker (Places Autocomplete) MUST use the same
 * id + libraries array — conflicting useJsApiLoader options white-screen FriendRide.
 * Never load `visualization` (deprecated HeatmapLayer crashes Maps JS).
 */
export const MAPS_LOADER_ID = 'clemson-google-maps-circles-places-v3'
/** Places only — Circles heat does not need visualization. */
export const MAP_LIBRARIES = ['places']

export function mapsLoaderOptions(apiKey) {
  return {
    id: MAPS_LOADER_ID,
    googleMapsApiKey: (apiKey || '').trim() || ' ',
    libraries: MAP_LIBRARIES,
  }
}
