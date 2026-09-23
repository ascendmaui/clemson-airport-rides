export const HELP_CHIPS = {
  rider: [
    { label: 'Book an airport ride', text: 'How do I schedule a GSP or CLT ride?' },
    { label: 'Add a card', text: 'Where do I add a card for rides?' },
    { label: 'Student discount', text: 'How does the Clemson student discount work?' },
    { label: 'Ride with friends', text: 'How do friend rides and fare splits work?' },
    { label: 'Share live location', text: 'How do I share my live location?' },
  ],
  driver: [
    { label: 'Go online', text: 'How do I go online and accept a ride?' },
    { label: 'Driver signup', text: 'How do I finish driver signup and get approved?' },
    { label: 'Heat map', text: 'How do the heat map and map types work?' },
    { label: 'Offer a carpool', text: 'How do I offer a carpool?' },
    { label: 'Earnings', text: 'Where do I see earnings?' },
  ],
}

export const SUPPORT_CHIPS = {
  rider: [
    { label: 'Billing issue', text: 'I have a billing issue' },
    { label: 'Ride problem', text: 'I have a ride dispute' },
    { label: 'Bug report', text: 'I want to report a bug' },
    { label: 'Account access', text: 'I have an account problem' },
    { label: 'Safety', text: 'I have a safety concern' },
  ],
  driver: [
    { label: "Can't go online", text: 'I have a bug: I cannot go online' },
    { label: 'Fare question', text: 'I have a billing issue about a fare' },
    { label: 'Rider dispute', text: 'I have a ride dispute' },
    { label: 'App bug', text: 'I want to report a bug' },
    { label: 'Safety', text: 'I have a safety concern' },
  ],
}

export function categoryLabel(category) {
  switch (category) {
    case 'bug':
      return 'Bug'
    case 'billing':
      return 'Billing'
    case 'ride_dispute':
      return 'Ride dispute'
    case 'account':
      return 'Account'
    case 'safety':
      return 'Safety'
    case 'other':
      return 'Other'
    default: {
      const unknown = category
      return unknown ? String(unknown) : 'Other'
    }
  }
}
