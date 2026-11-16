# similas.github.io

Personal site of Ali Salimi Sadr — plain HTML/CSS/JS, served by GitHub Pages from `main` (root). No build step.

| File | What it is |
|---|---|
| `index.html` | Home page |
| `home.css` | Home page styles; colors are tokens at the top |
| `styles.css` | Styles for the sub-pages (`roomi/`) |
| `theme.js` | Light/dark theme (OS preference, remembered toggle) |
| `hero.js` | Hero animation: the name is "denoised" out of particle noise |
| `places.js` | **Cities on the globe** — add one line per city |
| `globe.js` | The "Places I've been" dotted globe (d3-geo + Natural Earth, no API key) |
| `ui.js` | Reveal-on-scroll and the cursor spotlight on cards |
| `roomi/` | ROOMI project page and its privacy policy |

## Adding a place

Open `places.js` and add a line:

```js
{ city: "Paris", country: "France", lat: 48.8566, lng: 2.3522 },
```

Coordinates: right-click the city on Google Maps and click the numbers to copy them.

## Preview locally

Open `index.html` in a browser, or run `python3 -m http.server` here and visit http://localhost:8000.
