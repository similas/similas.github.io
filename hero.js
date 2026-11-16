// Hero: the name is "denoised" out of Gaussian noise, like a diffusion model
// sampling an image. Each particle has a home pixel on the name (x0) and a
// noise vector (eps); at step t it sits near sqrt(ab)*x0 + sqrt(1-ab)*eps.
// After sampling, particles spring home and scatter away from the cursor.
// Click the hero to resample. The real <h1> stays in the DOM for readers and
// search engines; the canvas only paints over it.
(function () {
  var canvas = document.getElementById("heroCanvas");
  var hero = document.querySelector(".hero");
  var title = document.querySelector(".hero-name");
  var words = title ? title.querySelectorAll(".w") : [];
  if (!canvas || !hero || !title || !canvas.getContext) return;

  var ctx = canvas.getContext("2d");
  var stepEl = document.getElementById("hudStep");
  var cursorEl = document.getElementById("hudCursor");
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var T = 1000;              // diffusion steps shown in the HUD
  var SAMPLE_MS = 2600;      // how long one sampling run takes
  var DRIFTERS = 220;        // free particles that never settle (ambient noise)

  var W = 0, H = 0, dpr = 1;
  var parts = [];            // {hx, hy, ex, ey, x, y, vx, vy, c, free}
  var colors = ["#8b7bff", "#5ee6ff"];
  var mouse = { x: -9999, y: -9999, active: false };
  var startedAt = 0;
  var running = false;
  var visible = true;
  var raf = 0;

  function gauss() {
    var u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    colors = [
      cs.getPropertyValue("--p1").trim() || colors[0],
      cs.getPropertyValue("--p2").trim() || colors[1],
    ];
  }

  function hexToRgb(hex) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mix(a, b, t) {
    return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * t) + "," +
      Math.round(a[1] + (b[1] - a[1]) * t) + "," + Math.round(a[2] + (b[2] - a[2]) * t) + ")";
  }

  // Sample the name's pixels at exactly where the <h1> text sits.
  function build() {
    var rect = hero.getBoundingClientRect();
    W = rect.width; H = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";

    var tr = title.getBoundingClientRect();
    var cs = getComputedStyle(words[0] || title);
    var fontSize = parseFloat(cs.fontSize);
    var off = document.createElement("canvas");
    off.width = Math.ceil(W); off.height = Math.ceil(H);
    var o = off.getContext("2d");
    o.fillStyle = "#000";
    o.font = cs.fontWeight + " " + fontSize + "px " + cs.fontFamily;
    o.textBaseline = "alphabetic";
    if ("letterSpacing" in o) o.letterSpacing = cs.letterSpacing;
    // Draw each word exactly where the browser laid it out (handles wrapping).
    Array.prototype.forEach.call(words, function (w) {
      var wr = w.getBoundingClientRect();
      var m = o.measureText(w.textContent);
      var asc = m.fontBoundingBoxAscent || fontSize * 0.9;
      var desc = m.fontBoundingBoxDescent || fontSize * 0.22;
      var baseY = wr.top - rect.top + (wr.height - (asc + desc)) / 2 + asc;
      o.fillText(w.textContent, wr.left - rect.left, baseY);
    });

    var data = o.getImageData(0, 0, off.width, off.height).data;
    var step = Math.max(3, Math.round(fontSize / 30));
    var homes = [];
    for (var y = 0; y < off.height; y += step) {
      for (var x = 0; x < off.width; x += step) {
        if (data[(y * off.width + x) * 4 + 3] > 140) homes.push([x, y]);
      }
    }

    var c1 = hexToRgb(colors[0]), c2 = hexToRgb(colors[1]);
    var x0 = tr.left - rect.left, x1 = tr.right - rect.left;
    var spread = Math.min(W, H) * 0.42;
    parts = homes.map(function (h) {
      var ex = W / 2 + gauss() * spread * 1.3, ey = H / 2 + gauss() * spread * 0.8;
      return {
        hx: h[0], hy: h[1], ex: ex, ey: ey,
        x: reduceMotion ? h[0] : ex, y: reduceMotion ? h[1] : ey, vx: 0, vy: 0, free: false,
        c: mix(c1, c2, Math.max(0, Math.min(1, (h[0] - x0) / (x1 - x0 || 1)))),
        s: step * 0.33,
      };
    });
    for (var i = 0; i < DRIFTERS; i++) {
      var px = Math.random() * W, py = Math.random() * H;
      parts.push({
        hx: px, hy: py, ex: px, ey: py, x: px, y: py,
        vx: gauss() * 0.15, vy: gauss() * 0.15, free: true,
        c: mix(c1, c2, Math.random()), s: 0.8 + Math.random() * 0.9,
      });
    }
    hero.classList.add("has-particles");
  }

  // Noise schedule: alpha-bar goes 0 -> 1 as t goes T -> 0 (cosine-ish).
  function alphaBar(progress) {
    var p = Math.min(1, Math.max(0, progress));
    var e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    return e;
  }

  function frame(now) {
    raf = 0;
    if (!visible) return;
    var progress = reduceMotion ? 1 : (now - startedAt) / SAMPLE_MS;
    var ab = alphaBar(progress);
    var noise = Math.sqrt(1 - ab);
    var t = Math.round(T * (1 - Math.min(1, progress)));
    if (stepEl) stepEl.textContent = t;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var R = 90, R2 = R * R;
    var settled = progress >= 1;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.free) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x += W; else if (p.x > W) p.x -= W;
        if (p.y < 0) p.y += H; else if (p.y > H) p.y -= H;
      } else {
        var tx = Math.sqrt(ab) * p.hx + noise * p.ex;
        var ty = Math.sqrt(ab) * p.hy + noise * p.ey;
        // keep the weighted average on-canvas (sqrt terms don't sum to 1)
        var wsum = Math.sqrt(ab) + noise;
        tx /= wsum; ty /= wsum;
        var k = settled ? 0.06 : 0.18;
        p.vx += (tx - p.x) * k;
        p.vy += (ty - p.y) * k;
      }
      if (mouse.active) {
        var dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > 0.01) {
          var f = (1 - d2 / R2) * (p.free ? 0.6 : 4.5) / Math.sqrt(d2);
          p.vx += dx * f; p.vy += dy * f;
        }
      }
      if (!p.free) {
        p.vx *= 0.78; p.vy *= 0.78;
        p.x += p.vx; p.y += p.vy;
      }
      ctx.globalAlpha = p.free ? 0.35 : 0.55 + 0.45 * ab;
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.s, p.y - p.s, p.s * 2, p.s * 2);
    }
    ctx.globalAlpha = 1;

    if (!reduceMotion) raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (!raf && visible) raf = requestAnimationFrame(frame);
  }

  function resample() {
    parts.forEach(function (p) {
      if (p.free) return;
      var spread = Math.min(W, H) * 0.42;
      p.ex = W / 2 + gauss() * spread * 1.3;
      p.ey = H / 2 + gauss() * spread * 0.8;
    });
    startedAt = performance.now();
    kick();
  }

  function start() {
    readColors();
    build();
    startedAt = performance.now();
    running = true;
    kick();
  }

  hero.addEventListener("pointermove", function (e) {
    var r = hero.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.active = true;
    if (cursorEl) {
      var zx = ((mouse.x / W) * 2 - 1) * 3, zy = (1 - (mouse.y / H) * 2) * 3;
      cursorEl.textContent = "[ " + (zx >= 0 ? " " : "") + zx.toFixed(3) + ", " + (zy >= 0 ? " " : "") + zy.toFixed(3) + " ]";
    }
    if (reduceMotion) return;
    kick();
  });
  hero.addEventListener("pointerleave", function () { mouse.active = false; });
  hero.addEventListener("click", function (e) {
    if (e.target.closest("a, button")) return;
    if (!reduceMotion) resample();
  });

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (running) { build(); kick(); } }, 150);
  });

  document.addEventListener("themechange", function () {
    if (!running) return;
    readColors(); build(); kick();
  });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) kick();
    }).observe(hero);
  }

  var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  fontsReady.then(start, start);
})();
