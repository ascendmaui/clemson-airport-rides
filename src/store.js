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
function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null") || seed(); }
  catch { return seed(); }
}
function seed() { return { users: [], session: null, trips: [], bookings: [] }; }
function save(state) { localStorage.setItem(KEY, JSON.stringify(state)); return state; }
export function currentUser() {
  const s = load();
  return s.users.find((u) => u.id === s.session) || null;
}
export function signUp({ name, email, password }) {
  const s = load();
  const existing = s.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    if (existing.password !== password) throw new Error("That email is already in use.");
    s.session = existing.id; return save(s);
  }
  const user = { id: crypto.randomUUID(), name: name || email.split("@")[0], email, password, driver: null };
  s.users.push(user); s.session = user.id; return save(s);
}
export function signIn({ email, password }) {
  const s = load();
  const user = s.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user || user.password !== password) throw new Error("Email or password is wrong.");
  s.session = user.id; return save(s);
}
export function signOut() { const s = load(); s.session = null; return save(s); }
export function onboardDriver(data) {
  const s = load(); const user = s.users.find((u) => u.id === s.session);
  if (!user) throw new Error("Sign in first.");
  user.driver = { ...data, online: false, tripsCompleted: user.driver?.tripsCompleted || 0, earningsCents: user.driver?.earningsCents || 0 };
  return save(s);
}
export function setOnline(online) {
  const s = load(); const user = s.users.find((u) => u.id === s.session);
  if (!user?.driver) throw new Error("Onboard first."); user.driver.online = online; return save(s);
}
export function requestRide({ destId, direction, pickup, passengers, flight }) {
  const s = load(); const user = s.users.find((u) => u.id === s.session);
  if (!user) throw new Error("Sign in first.");
  const dest = DESTINATIONS.find((d) => d.id === destId);
  const fromAirport = dest.kind === "airport" && direction === "from_airport";
  const pickupPt = fromAirport ? PLACES[destId] : { ...CAMPUS, label: pickup };
  const dropPt = fromAirport ? { ...CAMPUS, label: pickup } : PLACES[destId];
  s.trips.push({ id: crypto.randomUUID(), riderId: user.id, driverId: null, status: "searching", destId, pickupLabel: pickupPt.label, dropoffLabel: dropPt.label, pickupLat: pickupPt.lat, pickupLng: pickupPt.lng, dropoffLat: dropPt.lat, dropoffLng: dropPt.lng, fareCents: dest.fare, depositCents: Math.round(dest.fare * 0.25), passengers, flight: flight || null, requestedAt: Date.now(), acceptedAt: null });
  return save(s);
}
export function cancelTrip(id) {
  const s = load(); const trip = s.trips.find((t) => t.id === id);
  if (trip && (trip.status === "searching" || trip.status === "accepted")) trip.status = "canceled";
  return save(s);
}
export function riderActive() {
  const s = load(); const uid = s.session;
  return s.trips.find((t) => t.riderId === uid && ["searching","accepted","arriving","in_progress"].includes(t.status)) || s.trips.filter((t) => t.riderId === uid && t.status === "completed" && Date.now() - (t.completedAt || 0) < 45000).at(-1) || null;
}
export function riderHistory() { const s = load(); return s.trips.filter((t) => t.riderId === s.session).slice().reverse(); }
export function driverOffers() { const s = load(); return s.trips.filter((t) => t.status === "searching" && t.riderId !== s.session); }
export function driverActive() { const s = load(); return s.trips.find((t) => t.driverId === s.session && ["accepted","arriving","in_progress"].includes(t.status)); }
export function acceptTrip(id) {
  const s = load(); const user = s.users.find((u) => u.id === s.session);
  const trip = s.trips.find((t) => t.id === id && t.status === "searching");
  if (!user?.driver || !trip) throw new Error("That request is gone.");
  trip.status = "accepted"; trip.driverId = user.id; trip.acceptedAt = Date.now();
  trip.driverName = user.driver.displayName || user.name;
  trip.vehicle = `${user.driver.vehicleColor} ${user.driver.vehicleMake} ${user.driver.vehicleModel}`;
  trip.plate = user.driver.plate; return save(s);
}
export function advanceTrip(id) {
  const s = load(); const trip = s.trips.find((t) => t.id === id && t.driverId === s.session);
  if (!trip) throw new Error("No active trip.");
  if (trip.status === "accepted") trip.status = "arriving";
  else if (trip.status === "arriving") trip.status = "in_progress";
  else if (trip.status === "in_progress") {
    trip.status = "completed"; trip.completedAt = Date.now();
    const driver = s.users.find((u) => u.id === s.session);
    if (driver?.driver) { driver.driver.tripsCompleted += 1; driver.driver.earningsCents += trip.fareCents; }
  }
  return save(s);
}
export function seedPractice() {
  const s = load(); const user = s.users.find((u) => u.id === s.session);
  if (!user?.driver) throw new Error("Onboard first.");
  s.trips.push({ id: crypto.randomUUID(), riderId: "practice-rider", driverId: null, status: "searching", destId: "gsp", pickupLabel: "Tillman Hall, Clemson", dropoffLabel: "GSP Airport", pickupLat: CAMPUS.lat, pickupLng: CAMPUS.lng, dropoffLat: GSP.lat, dropoffLng: GSP.lng, fareCents: 7500, depositCents: 1875, passengers: 1, flight: "AA 1234", requestedAt: Date.now() });
  return save(s);
}
export function maybeDispatchFleet() {
  const s = load();
  const open = s.trips.filter((t) => t.status === "searching" && t.riderId === s.session);
  const othersOnline = s.users.some((u) => u.id !== s.session && u.driver?.online);
  for (const trip of open) {
    if (Date.now() - trip.requestedAt < (othersOnline ? 18000 : 5000)) continue;
    trip.status = "accepted"; trip.driverId = "fleet-corolla"; trip.acceptedAt = Date.now();
    trip.driverName = "John"; trip.vehicle = "Blue Toyota Corolla"; trip.plate = "TIGER 1";
  }
  return save(s);
}
export function addBooking(booking) {
  const s = load(); s.bookings.push({ ...booking, id: crypto.randomUUID(), createdAt: Date.now() }); return save(s);
}
