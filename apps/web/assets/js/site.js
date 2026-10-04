// Shared behavior for every page: header, mobile menu, placeholders, countdown, reveal.
(function () {
  "use strict";
  const CFG = window.HASHCOIN || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  document.documentElement.classList.remove("no-js");

  // ---------- Toast ----------
  let toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      document.body.append(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
  }
  window.hcToast = toast;

  // ---------- Header ----------
  const header = $(".site-header");
  const onScroll = () => header && header.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const menuBtn = $(".menu-btn"), mobileNav = $(".mobile-nav");
  if (menuBtn && mobileNav) {
    const set = (open) => {
      menuBtn.setAttribute("aria-expanded", String(open));
      mobileNav.classList.toggle("open", open);
    };
    menuBtn.addEventListener("click", () => set(menuBtn.getAttribute("aria-expanded") !== "true"));
    mobileNav.addEventListener("click", (e) => { if (e.target.closest("a")) set(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") set(false); });
  }

  // ---------- Social links ----------
  $$("[data-social]").forEach((a) => {
    const url = CFG[a.dataset.social];
    if (url) {
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.removeAttribute("data-soon");
    }
  });

  // ---------- Contract address ----------
  $$("[data-ca]").forEach((b) => {
    if (CFG.ca) {
      const short = CFG.ca.slice(0, 4) + "…" + CFG.ca.slice(-4);
      $$(".ca-value", b).forEach((el) => (el.textContent = short));
      b.setAttribute("aria-label", "Copy contract address " + CFG.ca);
    }
    b.addEventListener("click", async () => {
      if (!CFG.ca) {
        toast("The contract address will be published here first, at launch. Ignore any address posted anywhere else before then.");
        return;
      }
      try {
        await navigator.clipboard.writeText(CFG.ca);
        toast("Contract address copied. Always check it matches this site.");
      } catch (e) {
        toast(CFG.ca);
      }
    });
  });

  // ---------- Placeholders ----------
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-soon]");
    if (!el) return;
    e.preventDefault();
    toast(el.dataset.soon || "Coming soon.");
  });

  // ---------- Countdown ----------
  const cd = $("[data-countdown]");
  if (cd) {
    const target = CFG.launchAt ? Date.parse(CFG.launchAt) : NaN;
    const units = { d: $("[data-cd=d]", cd), h: $("[data-cd=h]", cd), m: $("[data-cd=m]", cd), s: $("[data-cd=s]", cd) };
    const status = $("[data-countdown-status]");
    const pad = (n) => String(n).padStart(2, "0");
    if (!isNaN(target)) {
      cd.classList.add("set");
      if (status) {
        status.textContent = "Launch: " + new Date(target).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      }
      const tick = () => {
        let left = Math.max(0, Math.floor((target - Date.now()) / 1000));
        const d = Math.floor(left / 86400); left -= d * 86400;
        const h = Math.floor(left / 3600); left -= h * 3600;
        const m = Math.floor(left / 60); const s = left - m * 60;
        units.d.textContent = pad(d); units.h.textContent = pad(h); units.m.textContent = pad(m); units.s.textContent = pad(s);
      };
      tick();
      setInterval(tick, 1000);
    }
  }

  // ---------- Reveal on scroll ----------
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reveals = $$(".reveal");
  if (reduce || !("IntersectionObserver" in window)) {
    reveals.forEach((el) => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    reveals.forEach((el) => io.observe(el));
  }

  // ---------- Formatting helpers shared by pages ----------
  window.hcFmt = {
    usd(v) {
      const a = Math.abs(v);
      if (a >= 1e6) return "$" + (v / 1e6).toFixed(a >= 1e7 ? 1 : 2) + "M";
      if (a >= 1e4) return "$" + (v / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "K";
      if (a >= 1000) return "$" + Math.round(v).toLocaleString("en-US");
      if (a > 0 && a < 0.01) return "<$0.01";
      return (v < 0 ? "−$" : "$") + a.toFixed(2);
    },
    pct(v) { return v >= 10 ? v.toFixed(0) + "%" : v >= 1 ? v.toFixed(1) + "%" : v.toFixed(2) + "%"; },
    mult(v) { return (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + "×"; },
  };

  // GPU <select> builder shared by the home and calculator pages. Names only, grouped;
  // laptop GPUs estimated from desktop data are marked "est.".
  const GPU_GROUPS = [["NVIDIA", "NVIDIA desktop"], ["AMD", "AMD desktop"], ["Intel", "Intel desktop"], ["Laptops", "Laptops"], ["Workstation & mining cards", "Workstation and mining cards"]];
  // The card at the top of the dropdown (the default everywhere, so no card is picked for no reason).
  window.hcTopGpu = function () {
    const gpus = window.GPUS || [];
    for (const [key] of GPU_GROUPS) { const g = gpus.find((x) => x.group === key); if (g) return g; }
    return gpus[0];
  };
  window.hcFillGpuSelect = function (sel, selectedName) {
    const GROUPS = GPU_GROUPS;
    const groups = {};
    (window.GPUS || []).forEach((g) => {
      if (!groups[g.group]) groups[g.group] = [];
      groups[g.group].push(g);
    });
    GROUPS.forEach(([key, label]) => {
      if (!groups[key]) return;
      const og = document.createElement("optgroup");
      og.label = label;
      groups[key].forEach((g) => {
        const o = document.createElement("option");
        o.value = g.name;
        o.textContent = g.est ? g.name + " (est.)" : g.name;
        if (g.name === selectedName) o.selected = true;
        og.append(o);
      });
      sel.append(og);
    });
  };
})();
