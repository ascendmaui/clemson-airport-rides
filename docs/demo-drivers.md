# Demo map drivers

These twelve cars are drawn on the rider map only. Each one is `isDemo: true` and `source: "demo"`. They are not stored profiles, they are not offered, and they do not affect availability, matching, ETA, or price.

Hide a demo car when a real online driver is within about 200 meters. Real drivers stay on the map. A real driver with no `avatar_url` uses an initials badge (first and last initial) on `#F56600` or `#522D80`. A real driver never uses a file under `/demo-drivers/`. An uploaded `avatar_url` is shown as-is.

Photos live in `public/demo-drivers/` at 512px and 128px. The small file is the marker badge. The large file is the profile card.

| id | firstName | vehicle | color | photo | small |
| --- | --- | --- | --- | --- | --- |
| demo-marcus | Marcus | BMW X5 | Orange & Purple | /demo-drivers/01-marcus.webp | /demo-drivers/01-marcus@128.webp |
| demo-jenna | Jenna | Mercedes GLE | Orange & Purple | /demo-drivers/02-jenna.webp | /demo-drivers/02-jenna@128.webp |
| demo-darnell | Darnell | Audi Q7 | Orange & Purple | /demo-drivers/03-darnell.webp | /demo-drivers/03-darnell@128.webp |
| demo-priya | Priya | Range Rover Sport | Orange & Purple | /demo-drivers/04-priya.webp | /demo-drivers/04-priya@128.webp |
| demo-carlos | Carlos | Lexus RX | Orange & Purple | /demo-drivers/05-carlos.webp | /demo-drivers/05-carlos@128.webp |
| demo-hannah | Hannah | Porsche Macan | Orange & Purple | /demo-drivers/06-hannah.webp | /demo-drivers/06-hannah@128.webp |
| demo-terrence | Terrence | Cadillac Escalade | Orange & Purple | /demo-drivers/07-terrence.webp | /demo-drivers/07-terrence@128.webp |
| demo-mei | Mei | Genesis GV80 | Orange & Purple | /demo-drivers/08-mei.webp | /demo-drivers/08-mei@128.webp |
| demo-wade | Wade | Ford F-150 | white | /demo-drivers/09-wade.webp | /demo-drivers/09-wade@128.webp |
| demo-tasha | Tasha | Ford F-150 | orange | /demo-drivers/10-tasha.webp | /demo-drivers/10-tasha@128.webp |
| demo-luis | Luis | Ford F-150 | purple | /demo-drivers/11-luis.webp | /demo-drivers/11-luis@128.webp |
| demo-brooke | Brooke | Tesla Cybertruck | Silver | /demo-drivers/12-brooke.webp | /demo-drivers/12-brooke@128.webp |

Brooke is the only demo-map exception that names that make. The label on the map is `Cybertruck`.

iOS can read the same fields from `shared/demoFleet.js`: `id`, `firstName`, `make`, `model`, `year`, `body` (`suv`, `truck`, or `wedge`), `livery`, `label`, `photo`, `photoSmall`, `isDemo`, `source`, `bookable: false`.

Marker art is `shared/fleetCarSvg.js`. Colors are `#F56600` and `#522D80`, with tiger-stripe accents. The drawing is original and has no university marks. Motion is `requestAnimationFrame`, paused while `document.hidden` is true. Demo positions come from `simulatedFleetAt`. Real GPS is interpolated between fixes. Do not store these people as drivers.
