// The heat-index-rail behaviour. See THEME_SPEC.md §3.2.
//
// Collection mode: tiers are real Shopify filter values, so a click just
// navigates to the pre-built filter URL - native, URL-addressable,
// back-button-correct, no client state to get wrong.
//
// Client mode (homepage): toggles [hidden] on already-rendered cards, no
// refetch, no layout thrash, and mirrors the selection into the URL via
// history.replaceState so a filtered view is shareable.

function readSelectionFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('heat');
  if (!raw) return new Set();
  return new Set(raw.split(',').filter(Boolean));
}

function writeSelectionToUrl(selection) {
  const url = new URL(window.location.href);
  if (selection.size === 0) {
    url.searchParams.delete('heat');
  } else {
    url.searchParams.set('heat', Array.from(selection).join(','));
  }
  window.history.replaceState({}, '', url);
}

function applyClientFilter(rail, selection) {
  const gridId = rail.getAttribute('data-grid-target');
  const grid = gridId ? document.getElementById(gridId) : null;
  if (!grid) return;

  const cards = grid.querySelectorAll('[data-heat-card]');
  let visibleCount = 0;
  cards.forEach((card) => {
    const heat = card.getAttribute('data-heat');
    const matches = selection.size === 0 || selection.has(heat);
    card.hidden = !matches;
    if (matches) visibleCount += 1;
  });

  window.EmberAsh?.announce?.(`${visibleCount} sauces shown`);
}

export function initHeatRail(rail) {
  const mode = rail.getAttribute('data-mode');
  const tiers = Array.from(rail.querySelectorAll('[data-heat-tier]'));
  const clearButton = rail.querySelector('[data-heat-tier-clear]');

  if (mode === 'collection') {
    tiers.forEach((tier) => {
      tier.addEventListener('click', () => {
        const href = tier.getAttribute('data-href');
        if (href) window.location.href = href;
      });
    });
    clearButton?.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.search = '';
      window.location.href = url.toString();
    });
    return;
  }

  const selection = readSelectionFromUrl();
  tiers.forEach((tier) => {
    const value = tier.getAttribute('data-heat-tier');
    if (value && selection.has(value)) tier.setAttribute('aria-selected', 'true');
  });
  applyClientFilter(rail, selection);

  tiers.forEach((tier) => {
    tier.addEventListener('click', () => {
      const value = tier.getAttribute('data-heat-tier');
      if (!value) return;
      const isSelected = tier.getAttribute('aria-selected') === 'true';
      if (isSelected) {
        selection.delete(value);
        tier.setAttribute('aria-selected', 'false');
      } else {
        selection.add(value);
        tier.setAttribute('aria-selected', 'true');
      }
      writeSelectionToUrl(selection);
      applyClientFilter(rail, selection);
    });

    tier.addEventListener('keydown', (event) => {
      const index = tiers.indexOf(tier);
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        tiers[(index + 1) % tiers.length]?.focus();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        tiers[(index - 1 + tiers.length) % tiers.length]?.focus();
      }
    });
  });

  clearButton?.addEventListener('click', () => {
    selection.clear();
    tiers.forEach((tier) => tier.setAttribute('aria-selected', 'false'));
    writeSelectionToUrl(selection);
    applyClientFilter(rail, selection);
  });
}
