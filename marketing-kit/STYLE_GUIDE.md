# Style guide

Colors and type below are copied from the repository. The marketing kit uses those values. It does not add a second palette.

## Brand colors

| Role | Hex | Where it is defined |
| --- | --- | --- |
| Orange | `#F56600` | `packages/rides-native/places.js` (`ORANGE`), `src/styles/tokens.css` (`--orange`) |
| Orange, bright | `#F66733` | `packages/rides-native/places.js` (`ORANGE_BRIGHT`) |
| Orange text on a light surface | `#BA4700` | `src/styles/tokens.css` (`--orange-text`) |
| Orange, darker text | `#963800` | `src/styles/tokens.css` (`--orange-dark`) |
| Purple | `#522D80` | `packages/rides-native/places.js` (`PURPLE`), `src/styles/tokens.css` (`--purple`) |
| Ink | `#0B1220` | `packages/rides-native/places.js` (`INK`), `src/styles/tokens.css` (`--ink`) |
| Ink, secondary | `#5C6570` | `packages/rides-native/places.js` (`INK_SECONDARY`); rider marketing surfaces in `src/styles/liquidGlass.css` |
| Ink, secondary (web token) | `#5B6472` | `src/styles/tokens.css` (`--ink-secondary`) |
| Surface | `#F7F4F0` | `packages/rides-native/places.js` (`SURFACE`); rider marketing background in `src/styles/liquidGlass.css` |
| White | `#FFFFFF` | `packages/rides-native/shared/theme.js`; `src/styles/tokens.css` (`--surface`) |
| Muted surface | `#F4F5F8` | `src/styles/tokens.css` (`--surface-muted`) |
| Danger | `#D92D20` | `src/styles/tokens.css` (`--danger`) |
| Danger, places.js | `#B42318` | `packages/rides-native/places.js` (`DANGER`) |
| Success | `#1F8A4C` | `src/styles/tokens.css` (`--success`) |
| Shadow | `#1A1033` | `packages/rides-native/shared/theme.js` |

`src/styles/tokens.css` notes `#522D80` as the purple text color on white, and `#BA4700` as orange text on a light surface. Use `#F56600` for fills, the mark, and large buttons. Use `#BA4700` for small orange labels on `#F7F4F0` or white. Button label color on orange is white (`onAccent` in `apps/rider/lib/palette.ts`).

Night surfaces in `apps/rider/lib/palette.ts`: background `#0E0B14`, card `#16121F`, elevated `#1E192A`, ink `#F5F6F8`, secondary ink `#A7A2B3`. Orange and purple stay `#F56600` and `#522D80`. This kit’s exports use the light surface.

Older rules in `src/styles.css` (`--navy`, `--paper`, DM Sans, Oswald) are not the rider marketing tokens. Do not mix them into this kit.

## Type

Web tokens in `src/styles/tokens.css`:

```css
--font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
```

`index.html` loads Inter (weights 400, 500, 600, 700) and Outfit (weights 300, 400, 500, 600). Outfit is used by `src/styles/luxury.css` (`Outfit, Inter, var(--font)`).

Rider and driver marketing surfaces in `src/styles/liquidGlass.css` set:

```css
--rider-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
```

The comment there says React Native uses the system font and Inter is the web fallback. Native type sizes live in `packages/rides-native/shared/theme.js` (`type.display` 32/800, `type.title` 28/800, `type.body` 14/400, `type.button` 16/700, `type.kicker` 12/800 with letter-spacing 1.1).

This kit sets Inter on the SVG and HTML sources because that is the webfont `index.html` loads. Static Inter on this machine has a Bold face at weight 700. The app tokens ask for weight 800; the exports use 700 so the installed Bold face is the one that draws.

## Shape

From `packages/rides-native/shared/theme.js`: card radius 20, sheet radius 28, pill radius 999. Screen padding is 16. The mark’s corner radius is 226 on a 1024 tile (the same 0.22 ratio as `scripts/render-marketing-brand.py`). The lockup file keeps a 40px `#F7F4F0` margin. Keep that margin when the lockup is placed on the same surface.

## Logo

- `logo/mark.svg` is the square mark. The pin path is the rider glyph from `public/brand/rider-icon.svg`. The tile is `#F56600` with a `#522D80` pool in the lower corner.
- `logo/lockup.svg` is the mark plus the wordmark “Clemson RIDES” in `#522D80`, which is the marketing name color in `src/styles/liquidGlass.css`.
- Do not redraw the pin as a paw, a tiger, or a stripe pattern.
- Do not stretch the mark. Scale it evenly.
- The driver app icon (`public/brand/driver-icon.svg`) is a separate steering-wheel mark. It is not the wordmark.

## Ride types

The only ride types in this kit are Standard, Wait & Save, Extra Comfort, and Carpool. Those are `OFFERED_RIDE_TIERS` in `shared/rideOptions.js`. Standard and Wait & Save use orange. Extra Comfort and Carpool use purple. That mapping is `rideTypeColor` in `shared/copy/rideTypes.js`.

## University marks

Do not use the Clemson paw. Do not use other Clemson University trademarks: the athletic tiger, official university logos, university wordmarks, or university seal.

The product name in the repo is “Clemson RIDES”. Using that product name is not a license to use university marks.

“Tiger Pass” and “Tiger Heat” are feature names in the product code (`shared/tigerPass.js`, `packages/rides-native/tigerHeat.js`). Those names are not permission to draw a tiger or to use university athletic art.

Any paw or other university trademark usage needs licensing review before it is added to this kit, the site, the apps, or an ad.

## Words that do not belong in this kit

Do not name any ride product outside Standard, Wait & Save, Extra Comfort, and Carpool. Do not describe the rides as autonomous, and do not name a vehicle pool. `tests/retiredCopy.test.js` keeps retired product names out of the repo.

Do not add ratings, download counts, rider counts, revenue, testimonials, or quotes from people. None of those are in this kit because the repo does not publish them as marketing claims.

Do not draw an App Store or Google Play badge. `shared/productLinks.js` sets the public store URLs to null. `docs/store-metadata.md` says the listings are not submitted.

## Voice

Use the sentences already in the product. The homepage headline is “Peace of mind, every ride” (`src/content/differentiators.js`). The primary button is “Book a ride”. Ride-type sentences are `RIDE_TYPE_NOTES` in `shared/copy/rideTypes.js`. The public FAQ is the `FAQ` list in `src/screens/MarketingInfo.jsx`.
