/** US-common vehicle makes, models, and colors for the driver application. */

export const VEHICLE_COLORS = [
  'Black',
  'White',
  'Silver',
  'Gray',
  'Red',
  'Blue',
  'Green',
  'Brown',
  'Beige',
  'Orange',
  'Yellow',
  'Gold',
  'Purple',
  'Other',
]

export const VEHICLE_MAKES = [
  'Toyota',
  'Honda',
  'Ford',
  'Chevrolet',
  'Tesla',
  'BMW',
  'Mercedes-Benz',
  'Nissan',
  'Hyundai',
  'Kia',
  'Volkswagen',
  'Subaru',
  'Mazda',
  'Jeep',
  'Lexus',
  'Audi',
  'GMC',
  'Ram',
  'Dodge',
  'Chrysler',
  'Buick',
  'Cadillac',
  'Acura',
  'Infiniti',
  'Volvo',
  'Porsche',
  'Mitsubishi',
  'Lincoln',
  'Mini',
  'Other',
]

const MODELS = {
  Toyota: ['Camry', 'Corolla', 'RAV4', 'Highlander', 'Tacoma', 'Prius', '4Runner', 'Sienna'],
  Honda: ['Civic', 'Accord', 'CR-V', 'Pilot', 'HR-V', 'Odyssey', 'Ridgeline'],
  Ford: ['F-150', 'Escape', 'Explorer', 'Mustang', 'Edge', 'Bronco', 'Fusion', 'Focus'],
  Chevrolet: ['Silverado', 'Equinox', 'Malibu', 'Tahoe', 'Traverse', 'Camaro', 'Colorado', 'Bolt'],
  Tesla: ['Model 3', 'Model Y', 'Model S', 'Model X'],
  BMW: ['3 Series', '5 Series', 'X3', 'X5', 'X1', '4 Series'],
  'Mercedes-Benz': ['C-Class', 'E-Class', 'GLC', 'GLE', 'A-Class', 'GLA'],
  Nissan: ['Altima', 'Sentra', 'Rogue', 'Pathfinder', 'Frontier', 'Murano', 'Versa'],
  Hyundai: ['Elantra', 'Sonata', 'Tucson', 'Santa Fe', 'Kona', 'Palisade', 'Ioniq'],
  Kia: ['Forte', 'K5', 'Sportage', 'Sorento', 'Telluride', 'Soul', 'Seltos'],
  Volkswagen: ['Jetta', 'Passat', 'Tiguan', 'Atlas', 'Golf', 'Taos'],
  Subaru: ['Outback', 'Forester', 'Crosstrek', 'Impreza', 'Legacy', 'Ascent'],
  Mazda: ['Mazda3', 'Mazda6', 'CX-5', 'CX-30', 'CX-50', 'CX-9'],
  Jeep: ['Wrangler', 'Grand Cherokee', 'Cherokee', 'Compass', 'Gladiator', 'Renegade'],
  Lexus: ['ES', 'RX', 'NX', 'IS', 'GX', 'UX'],
  Audi: ['A4', 'A6', 'Q5', 'Q7', 'Q3', 'A3'],
  GMC: ['Sierra', 'Terrain', 'Acadia', 'Yukon', 'Canyon'],
  Ram: ['1500', '2500', 'ProMaster'],
  Dodge: ['Charger', 'Challenger', 'Durango', 'Hornet'],
  Chrysler: ['Pacifica', '300', 'Voyager'],
  Buick: ['Encore', 'Envision', 'Enclave'],
  Cadillac: ['XT5', 'XT4', 'Escalade', 'CT5'],
  Acura: ['MDX', 'RDX', 'TLX', 'Integra'],
  Infiniti: ['Q50', 'QX50', 'QX60', 'QX80'],
  Volvo: ['XC60', 'XC90', 'XC40', 'S60'],
  Porsche: ['Macan', 'Cayenne', '911', 'Panamera'],
  Mitsubishi: ['Outlander', 'Eclipse Cross', 'Mirage'],
  Lincoln: ['Corsair', 'Nautilus', 'Aviator', 'Navigator'],
  Mini: ['Cooper', 'Countryman', 'Clubman'],
  Other: ['Other'],
}

export function modelsForMake(make) {
  if (!make) return []
  return MODELS[make] ? [...MODELS[make]] : ['Other']
}

export function isTeslaMakeModel(make, model) {
  return String(make || '').toLowerCase() === 'tesla' && /model\s*3/i.test(String(model || ''))
}
