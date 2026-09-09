// Ember & Ash - global behaviour: nav, gallery lightbox, sticky add-to-cart,
// aria-live announcements, and lazy-loading the heat rail when present.

// A single debounced aria-live region for the whole page - three
// competing live regions is worse than none. 300ms debounce means rapid
// calls (e.g. every keystroke while dragging a slot) collapse into one
// announcement. See THEME_SPEC.md §8.
let announceTimer;
function announce(message) {
  const region = document.getElementById('AnnounceRegion');
  if (!region) return;
  clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => {
    region.textContent = '';
    window.setTimeout(() => {
      region.textContent = message;
    }, 50);
  }, 300);
}
window.EmberAsh = { announce };

function initNavToggle() {
  const toggle = document.querySelector('[data-nav-toggle]');
  const nav = document.getElementById('MobileNav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', () => {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!isOpen));
    nav.hidden = isOpen;
  });
}

function initGallery() {
  const openButton = document.querySelector('[data-gallery-open]');
  const dialog = document.querySelector('[data-gallery-dialog]');
  const closeButton = document.querySelector('[data-gallery-close]');
  const dialogImage = document.querySelector('[data-gallery-dialog-image]');
  const mainImage = document.querySelector('.js-gallery-main-image');
  const thumbs = document.querySelectorAll('[data-gallery-thumb]');

  if (!dialog) return;

  if (openButton) {
    openButton.addEventListener('click', () => {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    });
  }

  if (closeButton) {
    closeButton.addEventListener('click', () => dialog.close());
  }

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  thumbs.forEach((thumb) => {
    thumb.addEventListener('click', () => {
      const fullSrc = thumb.getAttribute('data-full');
      const thumbImg = thumb.querySelector('img');
      if (fullSrc && dialogImage) dialogImage.src = fullSrc;
      if (fullSrc && mainImage) mainImage.src = fullSrc;
      thumbs.forEach((t) => t.setAttribute('aria-current', 'false'));
      thumb.setAttribute('aria-current', 'true');
      if (thumbImg) thumbImg.focus?.();
    });
  });
}

function initStickyAddToCart() {
  const bar = document.querySelector('[data-sticky-atc]');
  const form = document.getElementById('ProductForm');
  if (!bar || !form) return;

  const observer = new IntersectionObserver(
    ([entry]) => {
      bar.hidden = entry.isIntersecting;
    },
    { threshold: 0 },
  );
  observer.observe(form);

  const button = bar.querySelector('[data-sticky-atc-button]');
  button?.addEventListener('click', () => {
    form.requestSubmit();
  });
}

function initAddToFlightCta() {
  const link = document.querySelector('[data-add-to-flight]');
  if (!link) return;
  link.addEventListener('click', () => {
    const variantId = link.getAttribute('data-variant-id');
    if (!variantId) return;
    const url = new URL(link.href, window.location.origin);
    url.searchParams.set('flight_preseed', variantId);
    link.href = url.toString();
  });
}

function initProductVariantSelect() {
  const form = document.getElementById('ProductForm');
  if (!form) return;
  const selects = form.querySelectorAll('[data-product-option]');
  if (selects.length === 0) return;

  selects.forEach((select) => {
    select.addEventListener('change', () => {
      const url = new URL(window.location.href);
      // Native <select> options update ?variant= server-side on submit for
      // shops without JS; here we just keep the hidden variant id in sync
      // client-side so the page still works before hydration completes.
      url.searchParams.set('variant_option_changed', '1');
    });
  });
}

async function initHeatRail() {
  const rail = document.querySelector('[data-heat-rail]');
  if (!rail) return;
  const module = await import(window.EmberAshAssets.heatRail);
  module.initHeatRail(rail);
}

// The Flight Builder's ~250-line custom element is real weight - it loads
// only once its section scrolls into view, not on every page load that
// happens to include it. See THEME_SPEC.md §4.8.
function initFlightBuilder() {
  const el = document.querySelector('flight-builder');
  if (!el) return;

  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    import(window.EmberAshAssets.flightBuilder);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        load();
        observer.disconnect();
      }
    },
    { rootMargin: '200px' },
  );
  observer.observe(el);
  el.addEventListener('focusin', load, { once: true });
}

document.addEventListener('DOMContentLoaded', () => {
  initNavToggle();
  initGallery();
  initStickyAddToCart();
  initProductVariantSelect();
  initAddToFlightCta();
  initFlightBuilder();
  void initHeatRail();
});
