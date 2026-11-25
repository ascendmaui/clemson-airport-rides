/**
 * Common Clemson-area pickup and drop-off stops, checked before any remote
 * geocoder. Coordinates come from OpenStreetMap (Overpass / Nominatim,
 * Oct 2026). Data © OpenStreetMap contributors, ODbL 1.0.
 *
 * Rules for new rows:
 * - Do not reuse an id or label from NEIGHBORHOODS (carpoolEngine.js); pricing reads those.
 * - Never put GSP, CLT, ATL, Greenville, Charlotte or Hartsfield in a label or alias.
 *   lookupCatalogPlace() and label-only places still map those words to an airport.
 * - Keep aliases 4+ characters unless they are an exact lot code; searchCatalogPlaces
 *   also matches when the typed query contains an alias.
 */

function stop(id, label, lat, lng, kind, aliases = []) {
  return { id, label, lat, lng, kind, aliases: [label.toLowerCase(), ...aliases] }
}

export const CLEMSON_STOPS = [
  // On-campus housing, Greek housing
  stop('greek-quad', 'Fraternity & Sorority Quad', 34.68079, -82.83881, 'housing', ['greek row', 'greek village', 'greek quad', 'frat quad', 'fraternity quad', 'sorority quad', 'the quad', 'norris hall', 'bradley hall', 'donaldson hall', 'wannamaker hall', 'simpson hall', 'bowen hall']),
  stop('horseshoe', 'The Horseshoe (Barnett & Smith)', 34.67812, -82.83219, 'housing', ['horseshoe', 'barnett hall', 'smith hall', 'barnett', 'sorority halls']),
  stop('east-campus-halls', 'East Campus Halls (Lever, Manning, Mauldin)', 34.67735, -82.83229, 'housing', ['lever hall', 'manning hall', 'mauldin hall', 'shoeboxes', 'east campus']),
  stop('douthit-hills', 'Douthit Hills', 34.68025, -82.83260, 'housing', ['douthit', 'douthit hills']),
  stop('core-halls', 'Core Campus Halls (Cribb, DesChamps, Gressette)', 34.67952, -82.83956, 'housing', ['cribb', 'deschamps', 'gressette', 'core halls']),
  stop('honors-halls', 'Honors Halls (Holmes & McCabe)', 34.67882, -82.83861, 'housing', ['holmes hall', 'mccabe hall', 'honors college']),
  stop('west-campus-halls', 'West Campus Halls (Phi St)', 34.67799, -82.84038, 'housing', ['phi street', 'chi drive', 'benet hall', 'cope hall', 'geer hall', 'sanders hall', 'young hall', 'mickel hall', 'west campus']),
  stop('calhoun-courts', 'Calhoun Courts', 34.67759, -82.82900, 'housing', ['calhoun courts']),
  stop('lightsey-bridge', 'Lightsey Bridge', 34.67463, -82.82774, 'housing', ['lightsey', 'lightsey bridge']),
  stop('thornhill-village', 'Thornhill Village', 34.67793, -82.82633, 'housing', ['thornhill']),

  // Off-campus apartments
  stop('plaza-one89', 'Plaza One89', 34.68292, -82.84058, 'housing', ['plaza 189', 'one89', 'plaza one 89']),
  stop('courtyard-on-sloan', 'The Courtyard on Sloan', 34.68540, -82.83885, 'housing', ['courtyard on sloan']),
  stop('u-centre', 'U Centre on College', 34.68495, -82.83610, 'housing', ['u centre', 'u center on college', 'ucentre']),
  stop('tiger-park', 'Tiger Park Condos', 34.68320, -82.84388, 'housing', ['tiger park']),
  stop('the-cove', 'The Cove at Clemson', 34.69150, -82.84770, 'housing', ['the cove', 'cove at clemson']),
  stop('clemson-towers', 'Clemson Towers', 34.69333, -82.84862, 'housing', ['clemson towers']),
  stop('lakeside-lodge', 'Lakeside Lodge', 34.69172, -82.85581, 'housing', ['lakeside lodge', 'lakeside']),
  stop('lakeview-apartments', 'Lakeview Apartments', 34.69085, -82.83808, 'housing', ['lakeview']),
  stop('epoch', 'EPOCH Clemson', 34.69371, -82.85924, 'housing', ['epoch']),
  stop('harts-cove', "Hart's Cove", 34.69444, -82.86369, 'housing', ['harts cove', "hart's cove"]),
  stop('signature-hartwell', 'Signature Hartwell Village', 34.68930, -82.86043, 'housing', ['signature', 'hartwell village']),
  stop('view-at-the-pier', 'The View at the Pier', 34.65539, -82.86094, 'housing', ['view at the pier']),
  stop('riverbank-commons', 'Riverbank Commons', 34.69450, -82.84163, 'housing', ['riverbank']),
  stop('university-place', 'University Place', 34.69359, -82.83818, 'housing', ['university place']),
  stop('university-terrace', 'University Terrace', 34.69285, -82.83540, 'housing', ['university terrace']),
  stop('university-village', 'University Village', 34.71048, -82.78934, 'housing', ['university village']),
  stop('village-green', 'Village Green Townhomes', 34.68978, -82.83221, 'housing', ['village green']),
  stop('lemans', 'Lemans Apartments', 34.69424, -82.83292, 'housing', ['lemans', 'le mans']),
  stop('creekside', 'Creekside', 34.69736, -82.82597, 'housing', ['creekside']),
  stop('the-gallery', 'The Gallery at Clemson', 34.69463, -82.82321, 'housing', ['the gallery']),
  stop('crawford-mills', 'Crawford Mills', 34.68415, -82.81773, 'housing', ['crawford mills']),
  stop('crawford-falls', 'Crawford Falls', 34.68534, -82.81911, 'housing', ['crawford falls']),
  stop('fort-hill-commons', 'Fort Hill Commons', 34.68315, -82.81881, 'housing', ['fort hill commons']),
  stop('tillman-place', 'Tillman Place', 34.68439, -82.82185, 'housing', ['tillman place']),
  stop('college-heights', 'College Heights', 34.68288, -82.82173, 'housing', ['college heights']),
  stop('cedarwood', 'Cedarwood', 34.66802, -82.81798, 'housing', ['cedarwood']),
  stop('the-collective', 'The Collective at Clemson', 34.69630, -82.80805, 'housing', ['the collective', 'collective']),
  stop('the-retreat', 'The Retreat', 34.70056, -82.80042, 'housing', ['the retreat', 'retreat at clemson']),
  stop('village-at-berkeley', 'The Village at Berkeley', 34.69822, -82.79929, 'housing', ['berkeley']),
  stop('the-woodlands', 'The Woodlands', 34.70276, -82.79908, 'housing', ['woodlands']),
  stop('the-ridge', 'The Ridge Clemson', 34.69175, -82.78449, 'housing', ['the ridge']),
  stop('rosewood', 'Rosewood at Clemson', 34.69267, -82.78795, 'housing', ['rosewood']),
  stop('heritage-pointe', 'Heritage Pointe', 34.69913, -82.79303, 'housing', ['heritage pointe']),
  stop('hunters-glen', "Hunter's Glen", 34.70222, -82.79250, 'housing', ['hunters glen', "hunter's glen"]),
  stop('issaqueena-village', 'Issaqueena Village', 34.70055, -82.79337, 'housing', ['issaqueena']),
  stop('the-kenyon', 'The Kenyon at Cross Creek', 34.70886, -82.78417, 'housing', ['kenyon', 'cross creek']),
  stop('the-whitley', 'The Whitley', 34.71399, -82.78566, 'housing', ['whitley']),
  stop('everlan', 'Everlan of Clemson', 34.68375, -82.78511, 'housing', ['everlan']),
  stop('central-lofts', 'Central Lofts', 34.72306, -82.78104, 'housing', ['central lofts']),

  // Campus landmarks
  stop('hendrix', 'Hendrix Student Center', 34.67626, -82.83233, 'campus', ['hendrix']),
  stop('fike', 'Fike Recreation Center', 34.68080, -82.84180, 'campus', ['fike', 'fike rec']),
  stop('watt-center', 'Watt Family Innovation Center', 34.67607, -82.83689, 'campus', ['watt center', 'watt family']),
  stop('brooks-center', 'Brooks Center', 34.67392, -82.83582, 'campus', ['brooks center', 'brooks center for the performing arts']),
  stop('redfern', 'Redfern Health Center', 34.67572, -82.83358, 'campus', ['redfern', 'student health']),
  stop('botanical-garden', 'SC Botanical Garden', 34.67275, -82.82214, 'campus', ['botanical garden', 'south carolina botanical garden']),
  stop('doug-kingsmore', 'Doug Kingsmore Stadium', 34.67891, -82.84938, 'campus', ['kingsmore', 'baseball stadium']),
  stop('riggs-field', 'Riggs Field', 34.68181, -82.83888, 'campus', ['riggs field', 'soccer stadium']),
  stop('clemson-marina', 'Clemson Marina', 34.66395, -82.85899, 'campus', ['marina', 'clemson marina']),

  // Game-day lots and downtown decks
  stop('lot-p4', 'Stadium Lot P-4', 34.67762, -82.84807, 'parking', ['lot p-4', 'lot p4', 'p-4 lot']),
  stop('lot-c3', 'Stadium Lot C-3', 34.67833, -82.84596, 'parking', ['lot c-3', 'lot c3', 'c-3 lot']),
  stop('lot-c2', 'Stadium Lot C-2', 34.67443, -82.84313, 'parking', ['lot c-2', 'lot c2', 'c-2 lot']),
  stop('lot-r3', 'Stadium Lot R-3', 34.67634, -82.84537, 'parking', ['lot r-3', 'lot r3', 'r-3 lot']),
  stop('lot-e14', 'Stadium Lot E-14', 34.68096, -82.84252, 'parking', ['lot e-14', 'lot e14', 'e-14 lot']),
  stop('lot-e5', 'Stadium Lot E-5', 34.68098, -82.84056, 'parking', ['lot e-5', 'lot e5', 'e-5 lot']),
  stop('lot-c15', 'Lot C-15', 34.68281, -82.84799, 'parking', ['lot c-15', 'lot c15']),
  stop('keith-street-deck', 'Keith Street Parking Deck', 34.68480, -82.83789, 'parking', ['keith street', 'keith street deck']),
  stop('fendley-deck', 'Fendley Street Parking Deck', 34.68437, -82.83476, 'parking', ['fendley', 'fendley deck']),

  // Downtown
  stop('sloan-tap-room', 'Sloan Street Tap Room', 34.68362, -82.83797, 'downtown', ['sloan street tap room', 'tap room']),
  stop('top-of-the-tavern', 'Top of the Tavern', 34.68324, -82.83729, 'downtown', ['top of the tavern', 'tott']),
  stop('wingin-it', "Wingin' It", 34.68277, -82.83761, 'downtown', ['wingin it', "wingin' it"]),
  stop('the-abernathy', 'The Abernathy', 34.68315, -82.84328, 'downtown', ['abernathy']),

  // Hotels
  stop('shepherd-hotel', 'The Shepherd Hotel', 34.68398, -82.83765, 'hotel', ['shepherd hotel', 'the shepherd']),
  stop('martin-inn', 'Martin Inn & Madren Center', 34.66465, -82.84347, 'hotel', ['martin inn', 'madren', 'madren center', 'clemson university hotel']),
  stop('best-western-clemson', 'Best Western Plus University Inn', 34.68811, -82.82517, 'hotel', ['best western', 'university inn']),
  stop('comfort-inn-clemson', 'Comfort Inn & Suites Clemson', 34.69023, -82.82549, 'hotel', ['comfort inn']),
  stop('inn-at-clemson', 'Inn at Clemson', 34.69023, -82.82619, 'hotel', ['inn at clemson', 'inn @ clemson']),
  stop('courtyard-clemson', 'Courtyard by Marriott Clemson', 34.68932, -82.81387, 'hotel', ['courtyard clemson', 'courtyard marriott', 'marriott']),
  stop('days-inn-clemson', 'Days Inn Clemson', 34.68809, -82.81787, 'hotel', ['days inn']),
  stop('holiday-inn-express-clemson', 'Holiday Inn Express Clemson', 34.68861, -82.81837, 'hotel', ['holiday inn']),
  stop('hampton-inn-clemson', 'Hampton Inn Clemson', 34.69329, -82.84780, 'hotel', ['hampton inn']),
  stop('tru-clemson', 'Tru by Hilton Clemson', 34.68917, -82.86224, 'hotel', ['tru by hilton', 'hilton']),

  // Groceries, transit
  stop('publix-clemson', 'Publix (Tiger Blvd)', 34.68574, -82.81737, 'errand', ['publix']),
  stop('ingles-clemson', 'Ingles Clemson', 34.70136, -82.79523, 'errand', ['ingles']),
  stop('walmart-neighborhood', 'Walmart Neighborhood Market', 34.69679, -82.80107, 'errand', ['walmart neighborhood', 'neighborhood market']),
  stop('walmart-central', 'Walmart Supercenter (Central)', 34.70564, -82.76231, 'errand', ['walmart', 'walmart supercenter']),
  stop('aldi-clemson', 'ALDI Clemson', 34.68971, -82.85888, 'errand', ['aldi']),
  stop('clemson-amtrak', 'Clemson Amtrak Station', 34.69122, -82.83243, 'transit', ['amtrak', 'train station']),

  // Hospitals
  stop('oconee-memorial', 'Prisma Health Oconee Memorial Hospital', 34.69531, -82.98710, 'hospital', ['oconee memorial', 'hospital', 'seneca hospital', 'prisma oconee']),
  stop('anmed-medical-center', 'AnMed Medical Center (Anderson)', 34.51177, -82.64641, 'hospital', ['anmed', 'anderson hospital']),
  stop('baptist-easley', 'Prisma Health Baptist Easley Hospital', 34.84062, -82.60648, 'hospital', ['baptist easley', 'easley hospital']),

  // Nearby towns
  stop('seneca', 'Seneca', 34.68653, -82.95273, 'town', ['seneca', 'downtown seneca']),
  stop('central', 'Central', 34.72574, -82.78050, 'town', ['central sc', 'downtown central']),
  stop('southern-wesleyan', 'Southern Wesleyan University', 34.72878, -82.76384, 'town', ['southern wesleyan', 'swu']),
  stop('pendleton', 'Pendleton (Village Green)', 34.65080, -82.78360, 'town', ['pendleton', 'pendleton village green']),
  stop('anderson', 'Downtown Anderson', 34.50372, -82.65013, 'town', ['anderson', 'anderson sc']),
  stop('easley', 'Easley', 34.82693, -82.58171, 'town', ['easley']),
  stop('six-mile', 'Six Mile', 34.80738, -82.82005, 'town', ['six mile']),
  stop('liberty', 'Liberty', 34.78699, -82.69368, 'town', ['liberty sc']),
  stop('walhalla', 'Walhalla', 34.76482, -83.06404, 'town', ['walhalla']),
]

const KIND_BADGES = {
  airport: 'Airport',
  campus: 'Campus',
  housing: 'Housing',
  parking: 'Parking',
  downtown: 'Downtown',
  hotel: 'Hotel',
  hospital: 'Hospital',
  town: 'Town',
  errand: 'Store',
  transit: 'Transit',
}

/** Short badge shown next to a catalog suggestion. */
export function catalogKindLabel(kind) {
  return KIND_BADGES[kind] || 'Campus'
}
