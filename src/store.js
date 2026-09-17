/**
 * Local place/pricing helpers + legacy trip stubs.
 * Auth is Supabase-only (src/lib/auth.jsx). Do not use localStorage passwords.
 */
const KEY = "car.v1";
const CAMPUS = { lat: 34.6834, lng: -82.8374, label: "Tillman Hall, Clemson" };
const GSP = { lat: 34.8956, lng: -82.2189, label: "GSP Airport" };
export const PLACES = {
  campus: CAMPUS,
  gsp: GSP,
  clt: { lat: 35.214, lng: -80.9431, label: "CLT Airport" },
  death_valley: { lat: 34.6787, lng: -82.8432, label: "Memorial Stadium" },
  downtown: { lat: 34.6851, lng: -82.8364, label: "Downtown Clemson" },
  seneca: { lat: 34.6859, lng: -82.9535, label: "Seneca" },
};
export const DESTINATIONS = [
  { id: "gsp", kind: "airport", name: "GSP Airport", fare: 7500 },
  { id: "clt", kind: "airport", name: "CLT Airport", fare: 17500 },
  { id: "death_valley", kind: "local", name: "Memorial Stadium", fare: 1500 },
  { id: "downtown", kind: "local", name: "Downtown Clemson", fare: 1200 },
  { id: "seneca", kind: "local", name: "Seneca", fare: 2800 },
];
export function usd(cents) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function authRemoved(fn) {
  throw new Error(`${fn}: use Supabase Auth (src/lib/auth.jsx) — localStorage password auth removed`);
}
export function currentUser() { authRemoved("currentUser"); }
export function signUp() { authRemoved("signUp"); }
export function signIn() { authRemoved("signIn"); }
export function signOut() { authRemoved("signOut"); }

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null") || seed(); }
  catch { return seed(); }
}
function seed() { return { trips: [], bookings: [] }; }
function save(state) {
  const clean = { trips: state.trips || [], bookings: state.bookings || [] };
  localStorage.setItem(KEY, JSON.stringify(clean));
  return clean;
}

/** @deprecated Driver onboarding lives in Supabase (upsertDriverOnboarding). */
export function onboardDriver() {
  throw new Error("onboardDriver: use Supabase upsertDriverOnboarding");
}
/** @deprecated Online status via setDriverOnline in supabase.js */
export function setOnline() {
  throw new Error("setOnline: use Supabase setDriverOnline");
}

export function requestRide({ destId, direction, pickup, passengers, flight }) {
  const s = load();
  const dest = DESTINATIONS.find((d) => d.id === destId);
  if (!dest) throw new Error("Unknown destination");
  const fromAirport = dest.kind === "airport" && direction === "from_airport";
  const pickupPt = fromAirport ? PLACES[destId] : { ...CAMPUS, label: pickup };
  const dropPt = fromAirport ? { ...CAMPUS, label: pickup } : PLACES[destId];
  s.trips.push({
    id: crypto.randomUUID(),
    riderId: null,
    driverId: null,
    status: "searching",
    destId,
    pickupLabel: pickupPt.label,
    dropoffLabel: dropPt.label,
    pickupLat: pickupPt.lat,
    pickupLng: pickupPt.lng,
    dropoffLat: dropPt.lat,
    dropoffLng: dropPt.lng,
    fareCents: dest.fare,
    depositCents: Math.round(dest.fare * 0.25),
    passengers,
    flight: flight || null,
    requestedAt: Date.now(),
    acceptedAt: null,
  });
  return save(s);
}
export function cancelTrip(id) {
  const s = load();
  const trip = s.trips.find((t) => t.id === id);
  if (trip && (trip.status === "searching" || trip.status === "accepted")) trip.status = "canceled";
  return save(s);
}
export function riderActive() { return null; }
export function riderHistory() { return load().trips.slice().reverse(); }
export function driverOffers() { return load().trips.filter((t) => t.status === "searching"); }
export function driverActive() { return null; }
export function acceptTrip() {
  throw new Error("acceptTrip: use Supabase trips Realtime (DriverHome)");
}
export function advanceTrip() {
  throw new Error("advanceTrip: use Supabase trips updates");
}
/** Practice / simulate offers removed — drivers wait on Realtime. */
export function seedPractice() {
  throw new Error("seedPractice removed — use live Realtime trips");
}
export function maybeDispatchFleet() {
  return load();
}
export function addBooking(booking) {
  const s = load();
  s.bookings.push({ ...booking, id: crypto.randomUUID(), createdAt: Date.now() });
  return save(s);
}
