# similas.github.io

Personal site of Ali Salimi Sadr — plain HTML/CSS/JS, served by GitHub Pages from `main` (root). No build step.

| File | What it is |
|---|---|
| `index.html` | Home page |
| `styles.css` | All styles (shared with sub-pages); colors are tokens at the top |
| `theme.js` | Light/dark theme (OS preference, remembered toggle), sticky nav |
| `places.js` | **Cities on the map** — add one line per city |
| `map.js` | The "Places I've been" map (Leaflet + CARTO tiles) |
| `roomi/` | ROOMI project page and its privacy policy |

## Adding a place

Open `places.js` and add a line:

```js
{ city: "Paris", country: "France", lat: 48.8566, lng: 2.3522 },
```

Coordinates: right-click the city on Google Maps and click the numbers to copy them.

## Preview locally

Open `index.html` in a browser, or run `python3 -m http.server` here and visit http://localhost:8000.
