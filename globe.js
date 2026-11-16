// "Places I've been": a dotted globe drawn on canvas.
// Land is sampled into dots (Natural Earth via world-atlas, rasterized once with
// d3-geo); dots in countries I've visited glow. Cities come from places.js, with
// arcs flying out from home (Montréal). Drag to spin, hover a light for its name.
(function () {
  var places = window.PLACES || [];
  var canvas = document.getElementById("globe");
  var countEl = document.getElementById("mapCount");
  var tip = document.getElementById("globeTip");
  if (!canvas || !canvas.getContext) return;

  var visited = new Set(places.map(function (p) { return p.country; }));
  if (countEl) {
    countEl.textContent =
      places.length + (places.length === 1 ? " city" : " cities") + " · " +
      visited.size + (visited.size === 1 ? " country" : " countries");
  }

  var LAND_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";
  var HOME = "Montréal";
  var DOTS = 14000;                 // points on the sphere before keeping only land
  var RAD = Math.PI / 180;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var ctx = canvas.getContext("2d");
  var size = 0, dpr = 1, R = 0, cx = 0, cy = 0;
  var rotLon = -20, rotLat = 18;    // degrees; starts over Europe / the Middle East
  var velLon = 0, velLat = 0;
  var dragging = false, last = null, lastInteract = 0;
  var landDots = [];                // {lon, lat, v} v = visited
  var cities = places.map(function (p) { return { p: p, sx: 0, sy: 0, vis: false }; });
  var arcs = [];
  var colors = {};
  var visible = false, raf = 0, loaded = false;
  var hover = -1;

  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    function v(n, d) { return cs.getPropertyValue(n).trim() || d; }
    colors = {
      dot: v("--globe-dot", "rgba(255,255,255,0.16)"),
      dotVisited: v("--globe-visited", "rgba(255,255,255,0.85)"),
      arc: v("--accent", "#d4a373"),
      city: v("--accent", "#d4a373"),
      rim: v("--globe-rim", "rgba(255,255,255,0.05)"),
      body: v("--globe-body", "#09090c"),
    };
  }

  // ── Projection (orthographic, own math so we can cull and lift arcs) ──
  function project(lon, lat, alt) {
    var l = (lon + rotLon) * RAD, p = lat * RAD, t = rotLat * RAD;
    var cp = Math.cos(p), sp = Math.sin(p), cl = Math.cos(l), sl = Math.sin(l);
    var ct = Math.cos(t), st = Math.sin(t);
    var x = cp * sl;
    var y = sp * ct - cp * cl * st;
    var z = sp * st + cp * cl * ct;
    var k = R * (1 + (alt || 0));
    // [screenX, screenY, depth (z > 0 faces us), squared distance from center in globe radii]
    return [cx + x * k, cy - y * k, z, (x * x + y * y) * (1 + (alt || 0)) * (1 + (alt || 0))];
  }

  function resize() {
    var w = canvas.parentElement.clientWidth;
    size = Math.min(w, 620);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    R = size * 0.4;
    cx = cy = size / 2;
  }

  // ── Land dots: rasterize countries once, then sample a Fibonacci sphere ──
  function buildDots(world) {
    var countries = topojson.feature(world, world.objects.countries).features
      .filter(function (f) { return f.properties.name !== "Antarctica"; });
    var MW = 1440, MH = 720;
    var off = document.createElement("canvas");
    off.width = MW; off.height = MH;
    var o = off.getContext("2d", { willReadFrequently: true });
    var proj = d3.geoEquirectangular().scale(MW / (2 * Math.PI)).translate([MW / 2, MH / 2]);
    var path = d3.geoPath(proj, o);
    countries.forEach(function (f) {
      o.beginPath(); path(f);
      o.fillStyle = visited.has(f.properties.name) ? "#ff0000" : "#0000ff";
      o.fill();
    });
    var data = o.getImageData(0, 0, MW, MH).data;
    var golden = Math.PI * (3 - Math.sqrt(5));
    landDots = [];
    for (var i = 0; i < DOTS; i++) {
      var yy = 1 - (i / (DOTS - 1)) * 2;
      var lat = Math.asin(yy) / RAD;
      var lon = ((i * golden) / RAD) % 360;
      if (lon > 180) lon -= 360;
      var px = Math.min(MW - 1, Math.floor((lon + 180) / 360 * MW));
      var py = Math.min(MH - 1, Math.floor((90 - lat) / 180 * MH));
      var idx = (py * MW + px) * 4;
      if (data[idx + 3] < 100) continue;
      landDots.push({ lon: lon, lat: lat, v: data[idx] > data[idx + 2] });
    }
  }

  function buildArcs() {
    var home = places.filter(function (p) { return p.city === HOME; })[0];
    if (!home) return;
    var seen = new Set([home.country]);
    arcs = [];
    places.forEach(function (p, i) {
      if (seen.has(p.country)) return;
      seen.add(p.country);
      var interp = d3.geoInterpolate([home.lng, home.lat], [p.lng, p.lat]);
      var dist = d3.geoDistance([home.lng, home.lat], [p.lng, p.lat]);
      var pts = [];
      var N = 48;
      for (var s = 0; s <= N; s++) {
        var ll = interp(s / N);
        pts.push([ll[0], ll[1], Math.sin(Math.PI * s / N) * dist * 0.12]);
      }
      arcs.push({ pts: pts, offset: (i * 0.137) % 1 });
    });
  }

  // ── Draw ──
  function draw(now) {
    raf = 0;
    if (!visible) return;
    var idle = now - lastInteract > 1600;
    if (!dragging) {
      if (!reduceMotion && idle && hover < 0) velLon += (0.06 - velLon) * 0.02;
      rotLon += velLon;
      rotLat = Math.max(-60, Math.min(60, rotLat + velLat));
      velLat *= 0.94;
      if (!idle) velLon *= 0.95;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // atmosphere + body
    var g = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.25);
    g.addColorStop(0, colors.rim);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = colors.body;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // land dots
    var ds = Math.max(1, R / 210);
    for (var i = 0; i < landDots.length; i++) {
      var d = landDots[i];
      var q = project(d.lon, d.lat);
      if (q[2] <= 0) continue;
      var a = 0.25 + 0.75 * q[2];
      ctx.globalAlpha = d.v ? a : a * 0.9;
      ctx.fillStyle = d.v ? colors.dotVisited : colors.dot;
      var s = ds;
      ctx.fillRect(q[0] - s, q[1] - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;

    // arcs
    var phase = reduceMotion ? 0.5 : (now / 2600) % 1;
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";
    arcs.forEach(function (arc) {
      var proj = arc.pts.map(function (p) { return project(p[0], p[1], p[2]); });
      // visible if on the front face, or lifted out past the globe's edge
      function seen(q) { return q[2] > 0 || q[3] > 1; }
      ctx.strokeStyle = colors.arc;
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      var pen = false;
      proj.forEach(function (q) {
        if (!seen(q)) { pen = false; return; }
        if (pen) ctx.lineTo(q[0], q[1]); else { ctx.moveTo(q[0], q[1]); pen = true; }
      });
      ctx.stroke();
      // traveling pulse
      var head = (phase + arc.offset) % 1;
      var hi = Math.floor(head * (proj.length - 1));
      var tail = Math.max(0, hi - 8);
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      pen = false;
      for (var k = tail; k <= hi; k++) {
        var q = proj[k];
        if (!seen(q)) { pen = false; continue; }
        if (pen) ctx.lineTo(q[0], q[1]); else { ctx.moveTo(q[0], q[1]); pen = true; }
      }
      ctx.stroke();
      ctx.lineWidth = 1.2;
    });
    ctx.globalAlpha = 1;

    // cities
    var pulse = reduceMotion ? 0.5 : (Math.sin(now / 420) + 1) / 2;
    cities.forEach(function (c, i) {
      var q = project(c.p.lng, c.p.lat);
      c.vis = q[2] > 0.02;
      c.sx = q[0]; c.sy = q[1];
      if (!c.vis) return;
      var isHover = i === hover, isHome = c.p.city === HOME;
      var r = isHover ? 4.5 : isHome ? 3.6 : 2.6;
      var glow = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], r * (4 + pulse * 2));
      glow.addColorStop(0, colors.city);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.22 * q[2];
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(q[0], q[1], r * (4 + pulse * 2), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.6 + 0.4 * q[2];
      ctx.fillStyle = colors.city;
      ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    if (hover >= 0) placeTip(hover);
    if (!reduceMotion || dragging || Math.abs(velLon) + Math.abs(velLat) > 0.001) {
      raf = requestAnimationFrame(draw);
    }
  }

  function kick() { if (!raf && visible) raf = requestAnimationFrame(draw); }

  // ── Tooltip ──
  function placeTip(i) {
    var c = cities[i];
    if (!c.vis) { tip.hidden = true; return; }
    tip.innerHTML = "<strong>" + c.p.city + "</strong><span>" + c.p.country + (c.p.note ? " · " + c.p.note : "") + "</span>";
    tip.hidden = false;
    tip.style.left = canvas.offsetLeft + c.sx + "px";
    tip.style.top = canvas.offsetTop + c.sy + "px";
  }

  function pick(e) {
    var r = canvas.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    var best = -1, bd = 14 * 14;
    cities.forEach(function (c, i) {
      if (!c.vis) return;
      var dx = c.sx - mx, dy = c.sy - my, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = i; }
    });
    return best;
  }

  // ── Interaction ──
  canvas.addEventListener("pointerdown", function (e) {
    dragging = true;
    last = [e.clientX, e.clientY];
    velLon = velLat = 0;
    lastInteract = performance.now();
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("is-dragging");
    hover = pick(e);
    if (hover < 0) tip.hidden = true;
    kick();
  });
  canvas.addEventListener("pointermove", function (e) {
    lastInteract = performance.now();
    if (dragging && last) {
      var k = 180 / (Math.PI * R) * 0.9;
      var dLon = (e.clientX - last[0]) * k, dLat = (e.clientY - last[1]) * k;
      rotLon += dLon;
      rotLat = Math.max(-60, Math.min(60, rotLat + dLat));
      velLon = dLon; velLat = dLat;
      last = [e.clientX, e.clientY];
      hover = -1; tip.hidden = true;
    } else if (e.pointerType === "mouse") {
      var h = pick(e);
      if (h !== hover) { hover = h; if (h < 0) tip.hidden = true; }
      canvas.style.cursor = h >= 0 ? "pointer" : "grab";
    }
    kick();
  });
  function endDrag() {
    dragging = false; last = null;
    canvas.classList.remove("is-dragging");
    lastInteract = performance.now();
    kick();
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", function (e) {
    if (e.pointerType === "mouse" && !dragging) { hover = -1; tip.hidden = true; }
  });

  // ── Lifecycle ──
  function load() {
    if (loaded || !window.d3 || !window.topojson) return;
    loaded = true;
    fetch(LAND_URL)
      .then(function (r) { return r.json(); })
      .then(function (world) { buildDots(world); kick(); })
      .catch(function () { /* cities and arcs still draw without land */ });
  }

  readColors();
  resize();
  if (window.d3) buildArcs();

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) { load(); kick(); }
    }, { rootMargin: "300px" }).observe(canvas);
  } else {
    visible = true; load(); kick();
  }

  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(function () { resize(); kick(); }, 120);
  });
  document.addEventListener("themechange", function () { readColors(); kick(); });
})();
