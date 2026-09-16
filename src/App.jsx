import { useEffect, useState } from "react";
import L from "leaflet";
import {
  DESTINATIONS, PLACES, addBooking, acceptTrip, advanceTrip, cancelTrip,
  currentUser, driverActive, driverOffers, maybeDispatchFleet, onboardDriver,
  requestRide, riderActive, riderHistory, seedPractice, setOnline, signIn,
  signOut, signUp, usd,
} from "./store";

function path() { return window.location.hash.replace(/^#/, "") || "/"; }
function go(to) { window.location.hash = to; }
function Brand({ dark = true }) {
  return (
    <a className="brand" href="#/" onClick={() => go("/")}>
      <span className="paw">C</span>
      <span>
        <div className="display" style={{ fontSize: 15, color: dark ? "#f6f3ed" : "#07111c" }}>Clemson</div>
        <div className="display" style={{ fontSize: 11, color: "#f56600" }}>Airport Rides</div>
      </span>
    </a>
  );
}
function RideMap({ pickup, dropoff }) {
  const [el, setEl] = useState(null);
  useEffect(() => {
    if (!el) return;
    const map = L.map(el, { zoomControl: false, attributionControl: false, scrollWheelZoom: false });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 18 }).addTo(map);
    const a = [pickup.lat, pickup.lng]; const b = [dropoff.lat, dropoff.lng];
    L.polyline([a, b], { color: "#f56600", weight: 4 }).addTo(map);
    L.circleMarker(a, { radius: 7, color: "#07111c", fillColor: "#07111c", fillOpacity: 1 }).addTo(map);
    L.circleMarker(b, { radius: 7, color: "#f56600", fillColor: "#f56600", fillOpacity: 1 }).addTo(map);
    map.fitBounds([a, b], { padding: [80, 80], maxZoom: 13 });
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => { clearTimeout(t); map.remove(); };
  }, [el, pickup.lat, pickup.lng, dropoff.lat, dropoff.lng]);
  return <div className="map" ref={setEl} />;
}
export default function App() {
  const [route, setRoute] = useState(path());
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);
  useEffect(() => {
    const on = () => setRoute(path());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const user = currentUser();
  if (route.startsWith("/login")) return <Login onAuth={() => { refresh(); go("/ride"); }} />;
  if (route.startsWith("/ride")) return user ? <Ride user={user} refresh={refresh} /> : <Login onAuth={() => { refresh(); go("/ride"); }} />;
  if (route.startsWith("/activity")) return user ? <Activity /> : <Login onAuth={() => { refresh(); go("/activity"); }} />;
  if (route.startsWith("/account")) return user ? <Account user={user} refresh={refresh} /> : <Login onAuth={() => { refresh(); go("/account"); }} />;
  if (route.startsWith("/drive/onboard")) return user ? <Onboard user={user} refresh={refresh} /> : <Login onAuth={() => { refresh(); go("/drive/onboard"); }} />;
  if (route.startsWith("/drive")) return user ? <Drive user={user} refresh={refresh} /> : <Login onAuth={() => { refresh(); go("/drive"); }} />;
  if (route.startsWith("/earnings")) return user ? <Earnings user={user} /> : <Login onAuth={() => { refresh(); go("/earnings"); }} />;
  if (route.startsWith("/success")) return <Success />;
  return <Landing />;
}
function Landing() {
  const [airport, setAirport] = useState("GSP");
  const [direction, setDirection] = useState("to_airport");
  const [date, setDate] = useState(""); const [time, setTime] = useState("");
  const [name, setName] = useState(""); const [email, setEmail] = useState("");
  const [phone, setPhone] = useState(""); const [address, setAddress] = useState("");
  const fare = airport === "CLT" ? 17500 : 7500;
  const deposit = Math.round(fare * 0.25);
  function book(e) {
    e.preventDefault();
    if (!date || !time || name.length < 2 || !email.includes("@") || address.length < 6) {
      alert("Fill date, time, name, email, and a Clemson-area address."); return;
    }
    addBooking({ airport, direction, date, time, name, email, phone, address, fare, deposit });
    go("/success");
  }
  return (
    <div className="landing">
      <header className="topbar"><Brand /><button className="nav-cta" onClick={() => go("/ride")}>Ride now</button></header>
      <section className="hero"><div className="hero-bg" /><div className="hero-copy">
        <p className="kicker display">Pre-book · Reliable · No surge</p>
        <h1 className="display">Clemson<span>Airport Rides</span></h1>
        <p>Flat-rate cars to GSP and CLT. 25% deposit locks the fare.</p>
      </div></section>
      <div className="wrap">
        <div className="rates">
          <div className="rate-card"><p className="kicker display">GSP</p><p className="price display">{usd(7500)}</p><p>one way</p></div>
          <div className="rate-card"><p className="kicker display">CLT</p><p className="price display">{usd(17500)}</p><p>one way</p></div>
          <div className="rate-card"><p className="kicker display">Hold</p><p className="price display">25%</p><p>Deposit now</p></div>
        </div>
        <form className="panel form-grid" onSubmit={book}>
          <h2 className="display">Schedule a car</h2>
          <div className="seg">{["GSP","CLT"].map((c) => <button type="button" key={c} className={airport===c?"on":""} onClick={() => setAirport(c)}>{c}</button>)}</div>
          <div className="seg">{[["to_airport","To airport"],["from_airport","From airport"],["round_trip","Round trip"]].map(([v,l]) => <button type="button" key={v} className={direction===v?"on":""} onClick={() => setDirection(v)}>{l}</button>)}</div>
          <div className="row"><div><label>Pickup date</label><input className="field" type="date" value={date} onChange={(e)=>setDate(e.target.value)} /></div><div><label>Pickup time</label><input className="field" type="time" value={time} onChange={(e)=>setTime(e.target.value)} /></div></div>
          <div><label>Name</label><input className="field" value={name} onChange={(e)=>setName(e.target.value)} /></div>
          <div className="row"><div><label>Email</label><input className="field" type="email" value={email} onChange={(e)=>setEmail(e.target.value)} /></div><div><label>Mobile</label><input className="field" value={phone} onChange={(e)=>setPhone(e.target.value)} /></div></div>
          <div><label>Clemson-area address</label><input className="field" value={address} onChange={(e)=>setAddress(e.target.value)} /></div>
          <p className="muted">Fare {usd(fare)} · deposit {usd(deposit)}</p>
          <button className="primary" type="submit">Pay {usd(deposit)} deposit</button>
        </form>
        <p style={{padding:"24px 0 48px"}}><button className="ghost" onClick={()=>go("/ride")}>Open the rider app</button> · <button className="ghost" onClick={()=>go("/drive")}>Drive with us</button></p>
      </div>
    </div>
  );
}
function Success() {
  return <div className="login"><div className="login-box"><Brand dark={false} /><h1>Deposit received</h1><p className="muted">Your 25% hold is locked. Balance is due at pickup.</p><button className="primary" onClick={()=>go("/")}>Back to rates</button></div></div>;
}
function Login({ onAuth }) {
  const [mode, setMode] = useState("in"); const [name, setName] = useState("");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState("");
  function submit(e) {
    e.preventDefault();
    try { mode === "up" ? signUp({ name, email, password }) : signIn({ email, password }); onAuth(); }
    catch (err) { setError(err.message); }
  }
  return (
    <div className="login"><div className="login-box">
      <Brand dark={false} /><h1>Sign in</h1><p className="muted">Request a car or go online as a driver.</p>
      <form className="form-grid" style={{marginTop:24}} onSubmit={submit}>
        {mode==="up" ? <input className="light-field" placeholder="Name" value={name} onChange={(e)=>setName(e.target.value)} /> : null}
        <input className="light-field" type="email" required placeholder="Email" value={email} onChange={(e)=>setEmail(e.target.value)} />
        <input className="light-field" type="password" required minLength={8} placeholder="Password" value={password} onChange={(e)=>setPassword(e.target.value)} />
        {error ? <p className="err">{error}</p> : null}
        <button className="primary" type="submit">{mode==="up"?"Create account":"Sign in with email"}</button>
      </form>
      <button className="ghost" style={{marginTop:16}} onClick={()=>setMode(mode==="up"?"in":"up")}>{mode==="up"?"Have an account? Sign in":"New here? Create an account"}</button>
    </div></div>
  );
}
function RiderTabs({ active }) {
  return <nav className="tabs"><a className={active==="ride"?"on":""} href="#/ride">Ride</a><a className={active==="activity"?"on":""} href="#/activity">Trips</a><a className={active==="account"?"on":""} href="#/account">Account</a></nav>;
}
function DriverTabs({ active }) {
  return <nav className="tabs"><a className={active==="drive"?"on":""} href="#/drive">Drive</a><a className={active==="earnings"?"on":""} href="#/earnings">Earnings</a><a className={active==="account"?"on":""} href="#/account">Account</a></nav>;
}
function Ride({ user, refresh }) {
  const [step, setStep] = useState("where"); const [destId, setDestId] = useState("gsp");
  const [direction, setDirection] = useState("to_airport"); const [pickup, setPickup] = useState("Tillman Hall, Clemson");
  const [passengers, setPassengers] = useState(1); const [flight, setFlight] = useState("");
  const trip = riderActive(); const dest = DESTINATIONS.find((d)=>d.id===destId);
  useEffect(() => { const t = setInterval(() => { maybeDispatchFleet(); refresh(); }, 1600); return () => clearInterval(t); }, [refresh]);
  const pickupPt = dest.kind==="airport" && direction==="from_airport" ? PLACES[destId] : PLACES.campus;
  const dropPt = dest.kind==="airport" && direction==="from_airport" ? PLACES.campus : PLACES[destId];
  return (
    <div className="app">
      <RideMap pickup={trip?{lat:trip.pickupLat,lng:trip.pickupLng}:pickupPt} dropoff={trip?{lat:trip.dropoffLat,lng:trip.dropoffLng}:dropPt} />
      <div className="chrome-top"><Brand dark={false} /><span className="pill">Ride</span><a className="avatar" href="#/account">{(user.name||"R")[0].toUpperCase()}</a></div>
      <div className="sheet">
        {trip ? (
          <>
            <p style={{color:"var(--orange)",fontWeight:700,fontSize:12}}>{trip.status.replace("_"," ")}</p>
            <h2>{trip.status==="searching"?"Finding a nearby driver…":trip.status==="completed"?"Trip complete":`${trip.driverName||"Your driver"} is on the way`}</h2>
            <p className="muted">{trip.pickupLabel} → {trip.dropoffLabel}</p>
            {trip.status==="searching"?<div className="bar"><i /></div>:null}
            {trip.vehicle?<p>{trip.vehicle} · {trip.plate}</p>:null}
            <p>Fare {usd(trip.fareCents)} · deposit {usd(trip.depositCents)}</p>
            {trip.status==="searching"||trip.status==="accepted"?<button className="primary" onClick={()=>{cancelTrip(trip.id);refresh();}}>Cancel ride</button>:null}
          </>
        ) : step==="where" ? (
          <><p className="muted">Pickup</p><p>{pickup}</p><p style={{fontWeight:700,marginTop:12}}>Where to?</p>
          {DESTINATIONS.map((item)=>(<button key={item.id} className="dest" onClick={()=>{setDestId(item.id);setStep("confirm");}}><span>{item.name}</span><span className="muted">{usd(item.fare)}</span></button>))}</>
        ) : (
          <>
            <button className="ghost" onClick={()=>setStep("where")}>Destinations</button>
            <h2>{dest.name}</h2>
            {dest.kind==="airport"?<div className="seg" style={{margin:"12px 0"}}><button className={direction==="to_airport"?"on":""} onClick={()=>setDirection("to_airport")}>To airport</button><button className={direction==="from_airport"?"on":""} onClick={()=>setDirection("from_airport")}>From airport</button><span /></div>:null}
            <input className="light-field" value={pickup} onChange={(e)=>setPickup(e.target.value)} />
            <p className="muted" style={{marginTop:12}}>Passengers</p>
            <div className="pax">{[1,2,3,4].map((n)=><button key={n} className={passengers===n?"on":""} onClick={()=>setPassengers(n)}>{n}</button>)}</div>
            <p style={{margin:"12px 0"}}><strong style={{color:"var(--orange)",fontSize:28}}>{usd(dest.fare)}</strong><span className="muted"> · 25% {usd(Math.round(dest.fare*0.25))}</span></p>
            <button className="primary" onClick={()=>{requestRide({destId,direction,pickup,passengers,flight});refresh();}}>Request · {usd(Math.round(dest.fare*0.25))}</button>
          </>
        )}
      </div>
      <RiderTabs active="ride" />
    </div>
  );
}
function Activity() {
  const rows = riderHistory();
  return <div className="app" style={{background:"var(--paper)"}}><div className="page"><h1>Your rides</h1>{rows.length===0?<div className="card muted">No trips yet. <a href="#/ride">Request a ride</a></div>:rows.map((t)=><div className="card" key={t.id}><p style={{color:"var(--orange)",fontSize:12,fontWeight:700}}>{t.status.replace("_"," ")}</p><p>{t.pickupLabel} → {t.dropoffLabel}</p><p className="muted">{usd(t.fareCents)}</p></div>)}</div><RiderTabs active="activity" /></div>;
}
function Account({ user, refresh }) {
  return <div className="app" style={{background:"var(--paper)"}}><div className="page">
    <div className="card"><p className="muted">Signed in</p><h2>{user.name}</h2><p className="muted">{user.email}</p><button className="ghost" onClick={()=>{signOut();refresh();go("/");}}>Sign out</button></div>
    <a className="card" href="#/ride" style={{display:"block",textDecoration:"none",color:"inherit"}}><strong>Rider app</strong><p className="muted">Request a car to GSP, CLT, or campus.</p></a>
    <a className="card" href={user.driver?"#/drive":"#/drive/onboard"} style={{display:"block",textDecoration:"none",color:"inherit"}}><strong>{user.driver?"Driver app":"Become a driver"}</strong><p className="muted">{user.driver?`${user.driver.vehicleColor} ${user.driver.vehicleMake} ${user.driver.vehicleModel} · ${user.driver.plate}`:"Onboard your car and go online."}</p></a>
  </div>{user.driver?<DriverTabs active="account" />:<RiderTabs active="account" />}</div>;
}
function Onboard({ user, refresh }) {
  const [displayName, setDisplayName] = useState(user.name || "");
  const [phone, setPhone] = useState(""); const [vehicleMake, setVehicleMake] = useState("Toyota");
  const [vehicleModel, setVehicleModel] = useState("Corolla"); const [vehicleColor, setVehicleColor] = useState("Blue");
  const [vehicleYear, setVehicleYear] = useState("2022"); const [plate, setPlate] = useState("");
  function save(e) { e.preventDefault(); onboardDriver({ displayName, phone, vehicleMake, vehicleModel, vehicleColor, vehicleYear, plate }); refresh(); go("/drive"); }
  return <div className="login"><form className="login-box form-grid" onSubmit={save}><Brand dark={false} /><h1>Driver onboarding</h1>
    <input className="light-field" placeholder="Full name" value={displayName} onChange={(e)=>setDisplayName(e.target.value)} required />
    <input className="light-field" placeholder="Mobile" value={phone} onChange={(e)=>setPhone(e.target.value)} required />
    <div className="row"><input className="light-field" value={vehicleMake} onChange={(e)=>setVehicleMake(e.target.value)} /><input className="light-field" value={vehicleModel} onChange={(e)=>setVehicleModel(e.target.value)} /></div>
    <div className="row"><input className="light-field" value={vehicleColor} onChange={(e)=>setVehicleColor(e.target.value)} /><input className="light-field" value={vehicleYear} onChange={(e)=>setVehicleYear(e.target.value)} /></div>
    <input className="light-field" placeholder="License plate" value={plate} onChange={(e)=>setPlate(e.target.value)} required />
    <button className="primary">Save and go to driver home</button></form></div>;
}
function Drive({ user, refresh }) {
  const driver = user.driver; const trip = driverActive(); const offer = driverOffers()[0];
  useEffect(() => { const t = setInterval(refresh, 1500); return () => clearInterval(t); }, [refresh]);
  const pickup = trip ? { lat: trip.pickupLat, lng: trip.pickupLng } : PLACES.campus;
  const dropoff = trip ? { lat: trip.dropoffLat, lng: trip.dropoffLng } : PLACES.gsp;
  return <div className="app"><RideMap pickup={pickup} dropoff={dropoff} />
    <div className="chrome-top"><Brand dark={false} /><span className="pill">Drive</span>{driver?<button className="pill" onClick={()=>{setOnline(!driver.online);refresh();}}>{driver.online?"Online":"Offline"}</button>:<span />}</div>
    <div className="sheet">
      {!driver ? <><h2>Drive with Clemson Airport Rides</h2><p className="muted">Add your car and go online.</p><button className="primary" onClick={()=>go("/drive/onboard")}>Start onboarding</button></>
      : trip ? <><p style={{color:"var(--orange)",fontWeight:700,fontSize:12}}>{trip.status==="accepted"?"Head to pickup":trip.status==="arriving"?"Waiting at pickup":"En route"}</p><h2>{trip.pickupLabel}</h2><p className="muted">{trip.dropoffLabel}</p><p className="price">{usd(trip.fareCents)}</p><button className="primary" onClick={()=>{advanceTrip(trip.id);refresh();}}>{trip.status==="accepted"?"I've arrived":trip.status==="arriving"?"Start trip":"Complete trip"}</button></>
      : offer ? <><p style={{color:"var(--orange)",fontWeight:700,fontSize:12}}>New request</p><h2>{offer.pickupLabel}</h2><p className="muted">{offer.dropoffLabel}</p><p className="price">{usd(offer.fareCents)}</p><button className="primary" onClick={()=>{acceptTrip(offer.id);refresh();}}>Accept ride</button></>
      : !driver.online ? <div className="center"><button className="go" onClick={()=>{setOnline(true);refresh();}}>GO</button><p className="muted">You're offline. Tap GO.</p></div>
      : <><h2>Looking for riders</h2><p className="muted">{usd(driver.earningsCents)} earned · {driver.tripsCompleted} trips</p><button className="primary" onClick={()=>{seedPractice();refresh();}}>Send a practice request</button></>}
    </div><DriverTabs active="drive" /></div>;
}
function Earnings({ user }) {
  const driver = user.driver;
  let trips = [];
  try { trips = (JSON.parse(localStorage.getItem("car.v1")||"{}").trips||[]).filter((t)=>t.driverId===user.id).reverse(); } catch {}
  return <div className="app" style={{background:"var(--paper)"}}><div className="page"><p className="muted">Driver wallet</p><p className="price">{usd(driver?.earningsCents||0)}</p><p className="muted">{driver?.tripsCompleted||0} completed trips</p>{!driver?<button className="primary" onClick={()=>go("/drive/onboard")}>Onboard to start earning</button>:null}{trips.map((t)=><div className="card" key={t.id}><p>{t.dropoffLabel}</p><p className="muted">{t.status.replace("_"," ")} · {usd(t.fareCents)}</p></div>)}</div><DriverTabs active="earnings" /></div>;
}
