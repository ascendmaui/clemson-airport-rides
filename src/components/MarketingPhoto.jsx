import { resolveMarketingImage } from '../../shared/marketingImages.js'

export function MarketingPhoto({ id, eager = false, className = '' }) {
  const image = resolveMarketingImage(id)
  if (!image) return null
  return (
    <picture className={className ? `mkt-photo ${className}` : 'mkt-photo'}>
      <source type="image/webp" srcSet={image.srcSet} sizes={image.sizes} />
      <img
        src={image.src}
        alt={image.alt}
        width={1280}
        height={720}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={eager ? 'high' : 'auto'}
      />
    </picture>
  )
}
