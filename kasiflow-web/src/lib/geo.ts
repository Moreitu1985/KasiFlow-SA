/**
 * Small map helpers. The map only ever shows pins a customer dropped and spots a barber chose to share with a
 * check-in — KasiFlow never tracks anyone in the background.
 */
export interface LatLng {
  lat: number
  lng: number
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

/** Rounds to 6 decimals (about 10 cm), the precision the API stores. */
export function roundCoord(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

export interface Bounds {
  south: number
  west: number
  north: number
  east: number
}

/**
 * A box around the points, padded so pins are not on the edge and a single point still gets a street-level view.
 * Returns null when there is nothing valid to show.
 */
export function boundsFor(points: readonly LatLng[], minSpan = 0.006, padRatio = 0.15): Bounds | null {
  const ok = points.filter((p) => isValidLatLng(p.lat, p.lng))
  if (ok.length === 0) return null
  let south = Math.min(...ok.map((p) => p.lat))
  let north = Math.max(...ok.map((p) => p.lat))
  let west = Math.min(...ok.map((p) => p.lng))
  let east = Math.max(...ok.map((p) => p.lng))
  const padLat = Math.max((north - south) * padRatio, (minSpan - (north - south)) / 2, 0)
  const padLng = Math.max((east - west) * padRatio, (minSpan - (east - west)) / 2, 0)
  south = Math.max(-90, south - padLat)
  north = Math.min(90, north + padLat)
  west = Math.max(-180, west - padLng)
  east = Math.min(180, east + padLng)
  return { south, west, north, east }
}

/** Google Maps directions to a point (opens the phone's maps app where available). */
export function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${roundCoord(lat)},${roundCoord(lng)}`
}

/** Johannesburg: the default centre when there is nothing to show yet. */
export const DEFAULT_CENTER: LatLng = { lat: -26.2041, lng: 28.0473 }
