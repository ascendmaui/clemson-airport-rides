/** Clemson brand — subtle accents on glass UI */
export const orange = '#F56600';
export const purple = '#522D80';

export const Glass = {
  fill: 'rgba(255, 255, 255, 0.52)',
  fillStrong: 'rgba(255, 255, 255, 0.72)',
  border: 'rgba(255, 255, 255, 0.55)',
  hairline: 'rgba(82, 45, 128, 0.14)',
  shadow: {
    shadowColor: '#522D80',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 28,
    elevation: 10,
  },
  softShadow: {
    shadowColor: '#0B1220',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 5,
  },
};

export default {
  orange,
  purple,
  light: {
    text: '#0B1220',
    background: 'transparent',
    tint: orange,
    tabIconDefault: 'rgba(11,18,32,0.38)',
    tabIconSelected: orange,
    accent: purple,
  },
  dark: {
    text: '#F5F5F7',
    background: 'transparent',
    tint: orange,
    tabIconDefault: 'rgba(255,255,255,0.4)',
    tabIconSelected: orange,
    accent: purple,
  },
};
