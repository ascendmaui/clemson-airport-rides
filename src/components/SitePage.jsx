import { MarketingChrome } from './MarketingChrome'

export function SitePage({ current = '', children }) {
  return (
    <MarketingChrome current={current}>
      {children}
    </MarketingChrome>
  )
}
