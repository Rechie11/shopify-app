import { computeFlightPrice, computeNextTierNudge } from './flight-pricing.js';

const VALIDATE_DEBOUNCE_MS = 350;

function generateFlightToken() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `flight-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatMoney(cents) {
  // Shopify's own money format lives in Liquid; for JS-computed values we
  // fall back to a plain currency-agnostic cents display rather than
  // guessing at the shop's active currency formatting rules.
  return (cents / 100).toFixed(2);
}

class FlightBuilder extends HTMLElement {
  connectedCallback() {
    this.proxyUrl = this.dataset.proxyUrl;
    this.bundleHandle = this.dataset.bundleHandle;
    this.minItems = Number(this.dataset.minItems);
    this.maxItems = Number(this.dataset.maxItems);

    const snapshotScript = this.querySelector('[data-flight-snapshot]');
    this.bundle = JSON.parse(snapshotScript.textContent);

    this.skeleton = this.querySelector('[data-flight-skeleton]');
    this.body = this.querySelector('[data-flight-body]');
    this.slotsEl = this.querySelector('[data-flight-slots]');
    this.railEl = this.querySelector('[data-sauce-rail]');
    this.priceTotalEl = this.querySelector('[data-price-total]');
    this.priceSavingsEl = this.querySelector('[data-price-savings]');
    this.tierNudgeEl = this.querySelector('[data-tier-nudge]');
    this.heatCurveLine = this.querySelector('[data-heat-curve-line]');
    this.coachingEl = this.querySelector('[data-flight-coaching]');
    this.addButton = this.querySelector('[data-add-flight]');
    this.errorEl = this.querySelector('[data-flight-error]');
    this.proxyFallbackNote = this.querySelector('[data-proxy-fallback-note]');
    this.balanceDots = {
      heat: this.querySelector('[data-balance-dot="heat"]'),
      flavor: this.querySelector('[data-balance-dot="flavor"]'),
      duplication: this.querySelector('[data-balance-dot="duplication"]'),
      completeness: this.querySelector('[data-balance-dot="completeness"]'),
    };

    this.flightToken = generateFlightToken();
    this.slots = [];
    this.lastValidation = null;
    this.validateTimer = null;

    this.itemsByVariant = new Map(this.bundle.items.map((item) => [item.variantGid, item]));

    this.querySelectorAll('[data-size-option]').forEach((button) => {
      button.addEventListener('click', () => this.selectSize(Number(button.dataset.sizeOption)));
    });

    this.querySelectorAll('[data-variant-gid]').forEach((button) => {
      button.addEventListener('click', () => this.addToNextOpenSlot(button.dataset.variantGid));
      button.addEventListener('keydown', (event) => this.handleRailKeydown(event, button));
    });

    this.addButton.addEventListener('click', () => void this.addFlightToCart());

    const restored = this.restoreFromUrlOrSession();
    if (!restored) this.preseedFromQueryString();
  }

  // ---- Size step -----------------------------------------------------

  selectSize(size) {
    this.slots = new Array(size).fill(null);
    this.querySelectorAll('[data-size-option]').forEach((button) => {
      button.setAttribute('aria-checked', String(Number(button.dataset.sizeOption) === size));
    });
    this.body.hidden = false;
    this.renderSlots();
    this.updateComputedState();
  }

  // ---- Slot rail -------------------------------------------------------

  renderSlots() {
    this.slotsEl.innerHTML = '';
    this.slots.forEach((slot, index) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'flight-builder__slot';
      el.setAttribute('role', 'listitem');
      el.dataset.slotIndex = String(index);
      if (slot) {
        el.classList.add('flight-builder__slot--filled');
        el.setAttribute('aria-label', `Remove ${slot.productTitle} from slot ${index + 1}`);
        el.innerHTML = `<span class="heat-rail__flame" style="background: var(--c-heat-${slot.heatLevel ?? 0});"></span><span>${slot.productTitle}</span>`;
        el.addEventListener('click', () => this.clearSlot(index));
      } else {
        el.setAttribute('aria-label', `Empty slot ${index + 1}`);
        el.textContent = `${index + 1}`;
      }
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          this.clearSlot(index);
        }
      });
      this.slotsEl.appendChild(el);
    });
  }

  addToNextOpenSlot(variantGid) {
    const item = this.itemsByVariant.get(variantGid);
    if (!item || item.available === false) return;

    const openIndex = this.slots.findIndex((s) => s === null);
    if (openIndex === -1) {
      window.EmberAsh?.announce?.('This flight is full - remove a bottle to swap it.');
      return;
    }

    this.slots[openIndex] = item;
    this.renderSlots();
    this.updateComputedState();
    window.EmberAsh?.announce?.(`${item.productTitle} added to slot ${openIndex + 1}.`);
    this.persistState();
  }

  clearSlot(index) {
    const removed = this.slots[index];
    this.slots[index] = null;
    this.renderSlots();
    this.updateComputedState();
    if (removed) window.EmberAsh?.announce?.(`${removed.productTitle} removed.`);
    this.persistState();
  }

  applySwap(swapOutVariantGid, swapInVariantGid) {
    const index = this.slots.findIndex((s) => s?.variantGid === swapOutVariantGid);
    const item = this.itemsByVariant.get(swapInVariantGid);
    if (index === -1 || !item) return;
    this.slots[index] = item;
    this.renderSlots();
    this.updateComputedState();
    window.EmberAsh?.announce?.(`Swapped in ${item.productTitle}.`);
    this.persistState();
  }

  handleRailKeydown(event, button) {
    const rail = Array.from(this.querySelectorAll('[data-variant-gid]'));
    const index = rail.indexOf(button);
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      rail[(index + 1) % rail.length]?.focus();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      rail[(index - 1 + rail.length) % rail.length]?.focus();
    } else if (event.key === 'Escape') {
      button.blur();
    }
  }

  // ---- Pricing, heat curve, coaching ------------------------------------

  updateComputedState() {
    const filled = this.slots.filter((s) => s !== null);
    const itemPricesCents = filled.map((s) => s.unitPriceCents ?? 0);

    const price = computeFlightPrice({
      itemPricesCents,
      pricingMode: this.bundle.pricingMode,
      fixedPriceCents: this.bundle.fixedPriceCents,
      tiers: this.bundle.tiers,
    });
    this.renderPrice(price);

    const nudge = computeNextTierNudge(this.bundle.tiers, filled.length, this.maxItems);
    this.renderTierNudge(nudge);

    this.renderHeatCurve(filled);

    const allFilled = filled.length === this.slots.length && this.slots.length >= this.minItems;
    this.addButton.disabled = !allFilled;

    if (allFilled) {
      this.scheduleValidate();
    } else {
      this.lastValidation = null;
      this.coachingEl.textContent = '';
    }
  }

  renderPrice(price) {
    this.priceTotalEl.textContent = formatMoney(price.totalCents);
    if (price.savingsCents > 0) {
      this.priceSavingsEl.hidden = false;
      this.priceSavingsEl.textContent = `Save ${formatMoney(price.savingsCents)} (${Math.round(price.savingsPercent * 100)}%)`;
    } else {
      this.priceSavingsEl.hidden = true;
    }
  }

  renderTierNudge(nudge) {
    if (!nudge) {
      this.tierNudgeEl.hidden = true;
      return;
    }
    this.tierNudgeEl.hidden = false;
    this.tierNudgeEl.textContent = `Add ${nudge.itemsNeeded} more — save ${(nudge.nextDiscountBps / 100).toFixed(0)}% instead.`;
  }

  renderHeatCurve(filled) {
    if (filled.length === 0) {
      this.heatCurveLine.setAttribute('points', '');
      return;
    }
    const stepX = 200 / Math.max(filled.length - 1, 1);
    const points = filled
      .map((item, i) => {
        const heat = item.heatLevel ?? 0;
        const x = filled.length === 1 ? 100 : i * stepX;
        const y = 55 - (heat / 5) * 50;
        return `${x},${y}`;
      })
      .join(' ');
    this.heatCurveLine.setAttribute('points', points);
  }

  scheduleValidate() {
    clearTimeout(this.validateTimer);
    this.validateTimer = setTimeout(() => void this.validate(), VALIDATE_DEBOUNCE_MS);
  }

  async validate() {
    // Re-read current slots rather than trusting a snapshot captured when
    // this call was scheduled - the selection may have changed again
    // during the debounce window.
    const filled = this.slots.filter((s) => s !== null);
    if (filled.length !== this.slots.length) return;

    try {
      const url = new URL(`${this.proxyUrl}/validate`, window.location.origin);
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bundleHandle: this.bundleHandle,
          selections: filled.map((item) => ({ variantGid: item.variantGid })),
        }),
      });
      if (!res.ok) throw new Error(`validate failed with ${res.status}`);
      const data = await res.json();
      this.lastValidation = data;
      this.proxyFallbackNote.hidden = true;

      this.renderPrice(data.price);
      this.renderTierNudge(data.nextTierNudge);
      this.renderBalance(data.balance);
      this.renderCoaching(data.suggestion);
      this.renderSoldOut(data.soldOutReplacements);
      this.errorEl.hidden = data.valid;
      this.errorEl.textContent = data.valid ? '' : data.blocking.join(' ');
      this.addButton.disabled = !data.valid;
    } catch {
      // Proxy down: builder stays fully usable on the optimistic
      // client-side estimate already rendered. See THEME_SPEC.md §4.7.
      this.proxyFallbackNote.hidden = false;
    }
  }

  renderBalance(balance) {
    const setDot = (el, value) => {
      el.style.setProperty('--fill', String(Math.round(value * 100)));
    };
    setDot(this.balanceDots.heat, balance.heatSpread);
    setDot(this.balanceDots.flavor, balance.flavorDiversity);
    setDot(this.balanceDots.duplication, balance.duplication);
    const completeness = this.slots.filter((s) => s !== null).length / this.slots.length;
    setDot(this.balanceDots.completeness, completeness);
  }

  // "Variant sold out mid-build: slot marked, alternative offered inline,
  // CTA blocked until resolved." See THEME_SPEC.md §4.7.
  renderSoldOut(soldOutReplacements = []) {
    this.querySelectorAll('.flight-builder__slot--sold-out').forEach((el) => {
      el.classList.remove('flight-builder__slot--sold-out');
      el.querySelector('[data-sold-out-replace]')?.remove();
    });

    for (const entry of soldOutReplacements) {
      const index = this.slots.findIndex((s) => s?.variantGid === entry.variantGid);
      const slotEl = this.slotsEl.children[index];
      if (!slotEl) continue;
      slotEl.classList.add('flight-builder__slot--sold-out');

      if (entry.replacementVariantGid) {
        const replaceButton = document.createElement('button');
        replaceButton.type = 'button';
        replaceButton.dataset.soldOutReplace = 'true';
        replaceButton.className = 'button button--ghost';
        replaceButton.textContent = `Swap for ${entry.replacementProductTitle}`;
        replaceButton.addEventListener('click', (event) => {
          event.stopPropagation();
          this.applySwap(entry.variantGid, entry.replacementVariantGid);
        });
        slotEl.appendChild(replaceButton);
      }
    }
  }

  renderCoaching(suggestion) {
    if (!suggestion) {
      this.coachingEl.textContent = '';
      this.coachingEl.replaceChildren();
      return;
    }
    this.coachingEl.replaceChildren();
    this.coachingEl.append(suggestion.message + ' ');
    if (suggestion.swapInVariantGid) {
      const swapButton = document.createElement('button');
      swapButton.type = 'button';
      swapButton.className = 'button button--ghost';
      swapButton.textContent = 'Swap';
      swapButton.addEventListener('click', () =>
        this.applySwap(suggestion.swapOutVariantGid, suggestion.swapInVariantGid),
      );
      this.coachingEl.appendChild(swapButton);
    }
    window.EmberAsh?.announce?.(suggestion.message);
  }

  // ---- Add to cart -------------------------------------------------------

  async addFlightToCart() {
    const filled = this.slots.filter((s) => s !== null);
    if (filled.length !== this.slots.length) return;

    this.errorEl.hidden = true;
    this.addButton.disabled = true;

    try {
      const res = await fetch(`${window.Shopify?.routes?.root ?? '/'}cart/add.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: filled.map((item, index) => ({
            id: item.variantGid.split('/').pop(),
            quantity: 1,
            properties: {
              _flight_id: this.flightToken,
              _flight_name: this.bundle.handle,
              _flight_slot: String(index + 1),
            },
          })),
        }),
      });
      if (!res.ok) throw new Error(`cart/add.js failed with ${res.status}`);

      window.EmberAsh?.announce?.('Flight added to your cart.');
      this.flightToken = generateFlightToken();
      window.location.href = `${window.Shopify?.routes?.root ?? '/'}cart`;
    } catch {
      this.errorEl.hidden = false;
      this.errorEl.textContent = "Couldn't add this flight to your cart — please try again.";
      this.addButton.disabled = false;
    }
  }

  // ---- State persistence -------------------------------------------------

  serializeState() {
    const size = this.slots.length;
    const variantIds = this.slots.map((s) => (s ? s.variantGid.split('/').pop() : ''));
    return `${size}:${variantIds.join(',')}`;
  }

  persistState() {
    const serialized = this.serializeState();
    window.history.replaceState({}, '', `#flight=${serialized}`);
    try {
      window.sessionStorage.setItem(`emberash:flight:${this.bundleHandle}`, serialized);
    } catch {
      // Private browsing or storage disabled - URL hash persistence alone
      // still covers refresh/back-button/share.
    }
  }

  preseedFromQueryString() {
    const variantId = new URLSearchParams(window.location.search).get('flight_preseed');
    if (!variantId) return;
    const item = [...this.itemsByVariant.values()].find((i) => i.variantGid.endsWith(`/${variantId}`));
    if (!item) return;

    this.selectSize(this.minItems);
    this.slots[0] = item;
    this.renderSlots();
    this.updateComputedState();
    this.persistState();
  }

  restoreFromUrlOrSession() {
    const hashMatch = window.location.hash.match(/^#flight=(\d+):(.*)$/);
    let serialized = null;
    if (hashMatch) {
      serialized = `${hashMatch[1]}:${hashMatch[2]}`;
    } else {
      try {
        serialized = window.sessionStorage.getItem(`emberash:flight:${this.bundleHandle}`);
      } catch {
        serialized = null;
      }
    }
    if (!serialized) return false;

    const [sizePart, idsPart] = serialized.split(':');
    const size = Number(sizePart);
    if (!Number.isInteger(size) || size < this.minItems || size > this.maxItems) return false;

    this.selectSize(size);
    const ids = (idsPart ?? '').split(',');
    ids.forEach((id, index) => {
      if (!id) return;
      const item = [...this.itemsByVariant.values()].find((i) => i.variantGid.endsWith(`/${id}`));
      if (item && index < this.slots.length) {
        this.slots[index] = item;
      }
    });
    this.renderSlots();
    this.updateComputedState();
    return true;
  }
}

customElements.define('flight-builder', FlightBuilder);
