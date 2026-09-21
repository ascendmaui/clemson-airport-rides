export const DOWNTOWN_CENTER = { lat: 34.6836, lng: -82.8364 };

type Curve = 'bar' | 'late';

export const DOWNTOWN_VENUES: { id: string; name: string; lat: number; lng: number; radius: number; curve: Curve }[] = [
  { id: 'college-ave-core', name: 'College Ave', lat: 34.6839, lng: -82.8366, radius: 220, curve: 'bar' },
  { id: 'tiger-town', name: 'Tiger Town Tavern', lat: 34.6844, lng: -82.8362, radius: 90, curve: 'bar' },
  { id: 'study-hall', name: 'The Study Hall', lat: 34.6835, lng: -82.8368, radius: 80, curve: 'bar' },
  { id: 'keith-st', name: 'Keith St pickup', lat: 34.6848, lng: -82.8374, radius: 70, curve: 'late' },
];

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function barCurve(day: number, hour: number) {
  const weekend = day === 5 || day === 6;
  const thu = day === 4;
  if (hour < 16) return weekend ? 0.08 : 0.04;
  if (hour < 19) return weekend ? 0.28 : thu ? 0.18 : 0.1;
  if (hour < 21) return weekend ? 0.55 : thu ? 0.35 : 0.18;
  if (hour < 23) return weekend ? 0.92 : thu ? 0.58 : 0.28;
  if (hour === 23) return weekend ? 1 : thu ? 0.7 : 0.32;
  if (hour < 2) return weekend ? 0.78 : thu ? 0.45 : 0.16;
  return weekend ? 0.18 : 0.06;
}

function lateCurve(day: number, hour: number) {
  const weekend = day === 5 || day === 6;
  if (hour >= 21 || hour < 3) return weekend ? 0.85 : 0.35;
  return barCurve(day, hour) * 0.6;
}

export function downtownNow(date = new Date()) {
  const day = date.getDay();
  const hour = date.getHours();
  const spots = DOWNTOWN_VENUES.map((v) => {
    const raw = v.curve === 'late' ? lateCurve(day, hour) : barCurve(day, hour);
    return { ...v, intensity: clamp01(raw) };
  });
  const avg = spots.reduce((s, v) => s + v.intensity, 0) / spots.length;
  let label = 'Quiet';
  if (avg >= 0.75) label = 'Packed';
  else if (avg >= 0.45) label = 'Busy';
  else if (avg >= 0.22) label = 'Picking up';
  return { day, hour, avg, label, spots };
}
