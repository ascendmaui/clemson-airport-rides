# Marketing kit

Source files for Clemson RIDES. Nothing in this folder is a live post, a store listing, or a deploy. App Store and Play Store listings are not live.

Copy is taken from the product. It does not add ratings, download counts, testimonials, or quotes. Ride types are Standard, Wait & Save, Extra Comfort, and Carpool. Colors are Clemson orange `#F56600` and purple `#522D80`. The mark is the rider pin from `public/brand/rider-icon.svg`. It is not the Clemson paw. Any paw or other university trademark usage needs licensing review (`STYLE_GUIDE.md`).

## Index

| File | What it is |
| --- | --- |
| `STYLE_GUIDE.md` | Colors, type, logo, and trademark rules, with the repo file each value comes from |
| `SOCIAL_COPY.md` | Profile text and posts |
| `LANDING_COPY.md` | Hero, subhead, features, call to action, and FAQ |
| `PRESS_BLURB.md` | Short blurb, standard blurb, and a fact table |
| `logo/mark.svg` | Square mark, 1024×1024 |
| `logo/mark.png` | PNG export of the mark |
| `logo/lockup.svg` | Wordmark lockup, 1400×320 |
| `logo/lockup.png` | PNG export of the lockup |
| `social/x-header.svg` | X header source, 1500×500 |
| `social/x-header.html` | Same header as HTML |
| `social/x-header.png` | PNG export |
| `social/linkedin-banner.svg` | LinkedIn banner source, 1584×396 |
| `social/linkedin-banner.html` | Same banner as HTML |
| `social/linkedin-banner.png` | PNG export |
| `social/og-image.svg` | Open Graph source, 1200×630 |
| `social/og-image.html` | Same image as HTML |
| `social/og-image.png` | PNG export |
| `store/iphone-1290x2796.svg` | iPhone screenshot frame |
| `store/iphone-1290x2796.html` | Same frame as HTML |
| `store/iphone-1290x2796.png` | PNG export of the SVG frame |
| `store/mac-2880x1800.svg` | Mac screenshot frame |
| `store/mac-2880x1800.html` | Same frame as HTML |
| `store/mac-2880x1800.png` | PNG export of the SVG frame |

Screenshot frames are templates. They are not captures of a signed-in account. They show product labels and the documented airport flats. They do not show a sample fare quote, a person’s name, or a rating.

## Export

PNG files were written with `rsvg-convert` from the SVG sources:

```bash
rsvg-convert -w 1024 -h 1024 -o marketing-kit/logo/mark.png marketing-kit/logo/mark.svg
rsvg-convert -w 1400 -h 320 -o marketing-kit/logo/lockup.png marketing-kit/logo/lockup.svg
rsvg-convert -w 1500 -h 500 -o marketing-kit/social/x-header.png marketing-kit/social/x-header.svg
rsvg-convert -w 1584 -h 396 -o marketing-kit/social/linkedin-banner.png marketing-kit/social/linkedin-banner.svg
rsvg-convert -w 1200 -h 630 -o marketing-kit/social/og-image.png marketing-kit/social/og-image.svg
rsvg-convert -w 1290 -h 2796 -o marketing-kit/store/iphone-1290x2796.png marketing-kit/store/iphone-1290x2796.svg
rsvg-convert -w 2880 -h 1800 -o marketing-kit/store/mac-2880x1800.png marketing-kit/store/mac-2880x1800.svg
```

HTML files are the editable counterparts. Social and store HTML pages load `logo/mark.svg`.
