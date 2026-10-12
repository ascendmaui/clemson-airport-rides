// Driver sign-up page perks. Framed as what drivers get with Clemson RIDES.
// The comparison section states only what Clemson RIDES includes; it does not
// assert what any other app offers.

export const PAY_TIERS = [
  { id: 'orange', label: 'Orange', range: 'Under $30', note: 'Base', color: '#F56600' },
  { id: 'green', label: 'Green', range: '$30–35', note: 'Solid', color: '#22C55E' },
  { id: 'blue', label: 'Blue', range: '$35–40', note: 'Strong', color: '#3B82F6' },
  { id: 'gold', label: 'Gold', range: '$40–45', note: 'Great', color: '#EAB308' },
  { id: 'purple', label: 'Purple', range: '$45–50', note: 'Excellent', color: '#8B5CF6' },
  { id: 'diamond', label: 'Diamond', range: '$50–100', note: 'Escalating effects', color: '#7DD3FC' },
  { id: 'crown', label: 'Crown', range: 'Above $100', note: 'Top tier', color: '#FBBF24' },
]

export const PERK_GROUPS = [
  {
    id: 'see-pay',
    title: 'See the pay before you accept',
    perks: [
      { id: 'per-hour', icon: 'clock', title: 'Per-hour pay on every offer', body: 'Every offer shows what the trip works out to per hour, so you can compare offers at a glance.' },
      { id: 'rider', icon: 'star', title: 'Rider photo and star rating', body: 'Offers show the rider’s photo and star rating before you tap accept.' },
      { id: 'gauge', icon: 'gauge', title: 'Color-coded worth-it gauge', body: 'Each offer lights up by its hourly rate, from orange through Diamond and Crown. See the tier legend below.' },
    ],
  },
  {
    id: 'paid-fast',
    title: 'Get paid fast',
    perks: [
      { id: 'cashout', icon: 'bolt', title: 'Instant cash-out once a day', body: 'Move your earnings out once a day, whenever you choose.' },
      { id: 'tips', icon: 'heart', title: 'Tip boost: 100% to you', body: 'Riders can add $2, $5, $10 or a custom amount at booking. 100% of the tip goes to the driver.' },
    ],
  },
  {
    id: 'earn-more',
    title: 'Earn more',
    perks: [
      { id: 'streak', icon: 'flame', title: 'Streak bonuses', body: 'Keep a streak going and earn bonuses on top of your trip pay.' },
      { id: 'leaderboard', icon: 'trophy', title: 'Weekly leaderboard', body: 'See where you rank among drivers each week.' },
      { id: 'priority', icon: 'badge', title: 'Priority dispatch for top-rated drivers', body: 'Top-rated drivers get first look at offers.' },
      { id: 'referral', icon: 'users', title: 'Referral bonuses', body: 'Bring a driver friend on board and earn a referral bonus.' },
      { id: 'gameday', icon: 'flag', title: 'Game-day surge matching', body: 'On game days, matching steers you toward the surge so you spend less time empty.' },
      { id: 'party', icon: 'music', title: 'Party-ride queue', body: 'A dedicated queue for weekend and party rides around town.' },
    ],
  },
  {
    id: 'ai',
    title: 'Work smarter with AI',
    perks: [
      { id: 'forecast', icon: 'chart', title: 'AI earnings forecast', body: 'See your best hours and zones before you head out.' },
      { id: 'assistant', icon: 'chat', title: 'AI chat assistant', body: 'An assistant answers common rider questions so you can keep your eyes on the road.' },
      { id: 'disputes', icon: 'doc', title: 'Automated fare-dispute summaries', body: 'If a fare is disputed, you get a clear, automatic summary of the trip.' },
      { id: 'heatmap', icon: 'map', title: 'Real-time demand heat map', body: 'See where riders are requesting right now.' },
    ],
  },
  {
    id: 'safety',
    title: 'Safety & control',
    perks: [
      { id: 'safety-score', icon: 'shield', title: 'Safety score', body: 'Track your safety score and see how to keep it high.' },
      { id: 'scorecard', icon: 'car', title: 'Driver scorecard and custom car markers', body: 'Your scorecard unlocks custom car markers riders see on the map.' },
      { id: 'quiet', icon: 'moon', title: 'Driver-set quiet hours', body: 'Set the hours you don’t want offers, and we hold them.' },
    ],
  },
]

// Each row is a statement about Clemson RIDES only.
export const COMPARISON_ROWS = [
  'Per-hour pay shown on every offer',
  'Rider photo and star rating on offers',
  'Seven-tier color-coded worth-it gauge',
  'Instant cash-out once a day',
  'Tip boost at booking, 100% to the driver',
  'Streak bonuses and a weekly leaderboard',
  'Priority dispatch for top-rated drivers',
  'Referral bonuses',
  'Game-day surge matching and a party-ride queue',
  'AI earnings forecast for best hours and zones',
  'AI chat assistant for rider questions',
  'Automated fare-dispute summaries',
  'Real-time demand heat map',
  'Safety score and driver scorecard with custom car markers',
  'Driver-set quiet hours',
]

export const COMPARISON_NOTE = 'This table lists what you get with Clemson RIDES. It does not describe other apps; their features vary by market and change often, so check them directly. Uber and Lyft are trademarks of their respective owners. Clemson RIDES is not affiliated with or endorsed by either.'

// No rental partner yet: keep wording "typical" and never name a partner or a guaranteed price.
export const RENTAL = {
  title: 'No car? Rent one and start driving.',
  body: [
    'You can start with just a driver’s license and a passed background check. Rent a vehicle, drive for Clemson RIDES, and pay the weekly rental from your earnings.',
    'Typical weekly rentals run about $300–$400 and usually include liability insurance, maintenance and the basics.',
  ],
  points: [
    'Keep 100% of tip boosts riders add at booking',
    'See per-hour pay on every offer before you accept',
    'Instant cash-out once a day to cover the weekly rental',
  ],
  cta: 'Get matched with a rental',
  paths: [
    {
      id: 'fleet',
      kicker: 'Path 1',
      title: 'Clemson RIDES rental partner',
      status: 'Coming soon',
      body: 'We’re lining up a rental partner for Clemson RIDES drivers. Join the list and we’ll let you know when it opens.',
      cta: 'Get notified',
    },
    {
      id: 'turo',
      kicker: 'Path 2',
      title: 'Rent through Turo',
      body: 'Turo is a car-sharing marketplace, not a rideshare rental program. Its prohibited-uses policy bars paid passenger driving in California, Minnesota, New York and Oregon; South Carolina is not on that list. Some Turo hosts may allow rideshare use. Confirm with the host first, and check the host’s rideshare policy and Turo’s current terms before you book.',
      cta: 'Browse Turo near Clemson',
      href: 'https://turo.com/us/en/car-rental/united-states/clemson-sc',
      fine: 'Turo is a separate company. Clemson RIDES is not affiliated with or endorsed by Turo.',
    },
  ],
  note: 'Availability may vary. Rental terms, prices and included coverage are set by the rental provider and are not guaranteed by Clemson RIDES.',
}
