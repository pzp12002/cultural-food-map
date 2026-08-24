const EARTH_RADIUS_METERS = 6_371_000

export function calculateDistanceMeters(
  from: readonly [number, number],
  to: readonly [number, number],
): number {
  const latitudeDelta = toRadians(to[1] - from[1])
  const longitudeDelta = toRadians(to[0] - from[0])
  const fromLatitude = toRadians(from[1])
  const toLatitude = toRadians(to[1])
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2

  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine)))
}

export function formatDistance(distance?: number): string {
  if (!Number.isFinite(distance)) return '距离待确认'
  return distance! >= 1_000
    ? `${(distance! / 1_000).toFixed(1)} 公里`
    : `${Math.round(distance!)} 米`
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}
