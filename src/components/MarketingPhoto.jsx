import { resolveMarketingImage } from '../content/images.js'

/**
 * WebP srcset with a JPEG fallback. Below-the-fold photos lazy load.
 * Pass `sizes` when a photo renders wider than a hero collage tile so the
 * browser picks the 768 or 1280 file instead of upscaling the 480 one.
 */
export function MarketingPhoto({ id, eager = false, className = '', sizes }) {
  const image = resolveMarketingImage(id)
  if (!image) return null
  return (
    <picture className={className ? `mkt-photo ${className}` : 'mkt-photo'}>
      <source type="image/webp" srcSet={image.srcSet} sizes={sizes || image.sizes} />
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
