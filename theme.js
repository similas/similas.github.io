// Loaded in <head> so the right theme is applied before first paint (no flash).
// Theme = the visitor's saved choice, otherwise their OS preference.
(function () {
  var root = document.documentElement;
  var KEY = "theme";
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

  function saved() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function save(value) {
    try { localStorage.setItem(KEY, value); } catch (e) { /* storage blocked: still works for this visit */ }
  }

  function apply(theme) {
    root.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f5f4f0" : "#060608");
    document.dispatchEvent(new CustomEvent("themechange", { detail: theme }));
  }

  apply(saved() || (mq && mq.matches ? "light" : "dark"));

  if (mq && mq.addEventListener) {
    mq.addEventListener("change", function (e) {
      if (!saved()) apply(e.matches ? "light" : "dark");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var toggle = document.getElementById("themeToggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
        save(next);
        apply(next);
      });
    }

    var nav = document.querySelector(".nav");
    if (nav) {
      var onScroll = function () { nav.classList.toggle("is-scrolled", window.scrollY > 8); };
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    var year = document.getElementById("year");
    if (year) year.textContent = new Date().getFullYear();
  });
})();
