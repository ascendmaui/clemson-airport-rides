import type { ImageSourcePropType } from 'react-native'

/** Local JPEG copies of the fictional demo headshots. Real drivers never use this map. */
export const DEMO_HEADSHOTS: Record<string, { marker: ImageSourcePropType; card: ImageSourcePropType }> = {
  'demo-marcus': { marker: require('../assets/demo-headshots/marcus-128.jpg'), card: require('../assets/demo-headshots/marcus-512.jpg') },
  'demo-jenna': { marker: require('../assets/demo-headshots/jenna-128.jpg'), card: require('../assets/demo-headshots/jenna-512.jpg') },
  'demo-darnell': { marker: require('../assets/demo-headshots/darnell-128.jpg'), card: require('../assets/demo-headshots/darnell-512.jpg') },
  'demo-priya': { marker: require('../assets/demo-headshots/priya-128.jpg'), card: require('../assets/demo-headshots/priya-512.jpg') },
  'demo-carlos': { marker: require('../assets/demo-headshots/carlos-128.jpg'), card: require('../assets/demo-headshots/carlos-512.jpg') },
  'demo-hannah': { marker: require('../assets/demo-headshots/hannah-128.jpg'), card: require('../assets/demo-headshots/hannah-512.jpg') },
  'demo-terrence': { marker: require('../assets/demo-headshots/terrence-128.jpg'), card: require('../assets/demo-headshots/terrence-512.jpg') },
  'demo-mei': { marker: require('../assets/demo-headshots/mei-128.jpg'), card: require('../assets/demo-headshots/mei-512.jpg') },
  'demo-wade': { marker: require('../assets/demo-headshots/wade-128.jpg'), card: require('../assets/demo-headshots/wade-512.jpg') },
  'demo-tasha': { marker: require('../assets/demo-headshots/tasha-128.jpg'), card: require('../assets/demo-headshots/tasha-512.jpg') },
  'demo-luis': { marker: require('../assets/demo-headshots/luis-128.jpg'), card: require('../assets/demo-headshots/luis-512.jpg') },
  'demo-brooke': { marker: require('../assets/demo-headshots/brooke-128.jpg'), card: require('../assets/demo-headshots/brooke-512.jpg') },
}
