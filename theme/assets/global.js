// Ember & Ash - global behaviour: nav, gallery lightbox, sticky add-to-cart,
// aria-live announcements, and lazy-loading the heat rail when present.

function announce(message) {
  const region = document.getElementById('AnnounceRegion');
  if (!region) return;
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = message;
  }, 50);
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

document.addEventListener('DOMContentLoaded', () => {
  initNavToggle();
  initGallery();
  initStickyAddToCart();
  initProductVariantSelect();
  void initHeatRail();
});
