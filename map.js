// Interactive "Places I've been" map. City data lives in places.js.
// Countries are drawn as vector shapes (Natural Earth via world-atlas) and
// colored from the site's CSS tokens, so the map follows the light/dark theme
// and needs no tile server or API key.
(function () {
  var places = window.PLACES || [];
  var mapEl = document.getElementById("map");
  if (!mapEl) return;
  var card = mapEl.parentElement;
  var countEl = document.getElementById("mapCount");

  var LAND_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json";
  var visited = new Set(places.map(function (p) { return p.country; }));
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  countEl.textContent =
    places.length + (places.length === 1 ? " city" : " cities") + " · " +
    visited.size + (visited.size === 1 ? " country" : " countries");

  if (!window.L) {
    mapEl.innerHTML = '<p class="map-fallback">The map could not load.</p>';
    return;
  }

  var map = L.map(mapEl, {
    scrollWheelZoom: false, // don't hijack page scrolling until the visitor engages
    zoomControl: false,
    // minZoom must stay below the zoom needed to fit every pin, or Leaflet
    // clamps the initial view and the land layer renders out of sync.
    minZoom: 0,
    maxZoom: 8,
    zoomSnap: 0.25,
  });
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a>');
  L.control.zoom({ position: "bottomright" }).addTo(map);

  map.on("click", function () {
    map.scrollWheelZoom.enable();
    card.classList.add("is-active");
  });
  mapEl.addEventListener("mouseleave", function () { map.scrollWheelZoom.disable(); });

  // ── Pins ──
  var markers = places.map(function (p, i) {
    var marker = L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: "pin", html: "<span></span>", iconSize: [10, 10] }),
      title: p.city,
      alt: p.city + ", " + p.country,
      riseOnHover: true,
    }).addTo(map);
    var tip = "<strong>" + p.city + "</strong><small>" + p.country + (p.note ? " · " + p.note : "") + "</small>";
    marker.bindTooltip(tip, { className: "city-tip", direction: "top", offset: [0, -10] });
    marker.on("click", function () { select(i); });
    return marker;
  });

  function select(i) {
    var p = places[i];
    markers.forEach(function (m, j) {
      var el = m.getElement();
      if (el) el.classList.toggle("is-selected", i === j);
      if (i !== j) m.closeTooltip();
    });
    var zoom = Math.max(map.getZoom(), 6);
    if (reduceMotion) map.setView([p.lat, p.lng], zoom);
    else map.flyTo([p.lat, p.lng], zoom, { duration: 1.1 });
    markers[i].openTooltip();
    card.classList.add("is-active");
  }

  if (markers.length) {
    var pad = mapEl.offsetWidth < 500 ? 20 : 40;
    map.fitBounds(L.featureGroup(markers).getBounds(), { padding: [pad, pad], maxZoom: 4 });
  } else {
    map.setView([30, 10], 2);
  }

  // ── Land (loaded when the map is about to scroll into view) ──

  // Shapes that cross the 180° line (eastern Russia, Fiji) come with
  // longitudes jumping from +180 to -180, which Leaflet draws as a band across
  // the whole map. Shift their western half by +360° so each shape is continuous.
  function unwrapDateline(feature) {
    var g = feature.geometry;
    var polygons = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    polygons.forEach(function (rings) {
      var lngs = rings[0].map(function (c) { return c[0]; });
      if (Math.max.apply(null, lngs) - Math.min.apply(null, lngs) <= 180) return;
      rings.forEach(function (ring) {
        ring.forEach(function (c) { if (c[0] < 0) c[0] += 360; });
      });
    });
  }

  var landLoaded = false;
  function loadLand() {
    if (landLoaded || !window.topojson) return;
    landLoaded = true;
    fetch(LAND_URL)
      .then(function (r) { return r.json(); })
      .then(function (world) {
        var countries = topojson.feature(world, world.objects.countries);
        countries.features = countries.features.filter(function (f) {
          return f.properties.name !== "Antarctica";
        });
        countries.features.forEach(unwrapDateline);
        L.geoJSON(countries, {
          interactive: false,
          style: function (f) {
            return {
              className: "land" + (visited.has(f.properties.name) ? " is-visited" : ""),
              weight: 0.6,
              fillOpacity: 1,
            };
          },
        }).addTo(map);
      })
      .catch(function () { /* pins still work without land shapes */ });
  }

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) {
        loadLand();
        io.disconnect();
      }
    }, { rootMargin: "600px" });
    io.observe(mapEl);
  } else {
    loadLand();
  }

  window.addEventListener("resize", function () { map.invalidateSize(); });
})();
