/**
 * Left-to-right order of the web rider bottom tabs.
 * `home` is the Rides tab (route "home"). Native tab files stay separate.
 */
export const WEB_BOTTOM_TABS = Object.freeze([
  Object.freeze({ id: 'home', label: 'Rides', icon: 'car' }),
  Object.freeze({ id: 'schedule', label: 'Schedule', icon: 'schedule' }),
  Object.freeze({ id: 'friends', label: 'Friends', icon: 'carpool' }),
  Object.freeze({ id: 'account', label: 'Account', icon: 'profile' }),
])

export function webBottomTabIds() {
  return WEB_BOTTOM_TABS.map((tab) => tab.id)
}

export function webBottomTabLabels() {
  return WEB_BOTTOM_TABS.map((tab) => tab.label)
}
