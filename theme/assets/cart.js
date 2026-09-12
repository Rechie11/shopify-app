// Cart page behaviour: quantity changes via /cart/change.js with optimistic
// UI, and one "Remove flight" action that clears every line sharing a
// _flight_id in a single request. See THEME_SPEC.md §4.5 / §6.

async function changeQuantity(key, quantity) {
  const response = await fetch(`${window.Shopify?.routes?.root ?? '/'}cart/change.js`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: key, quantity }),
  });
  if (!response.ok) throw new Error(`cart/change.js failed with ${response.status}`);
  return response.json();
}

async function updateLines(updates) {
  const response = await fetch(`${window.Shopify?.routes?.root ?? '/'}cart/update.js`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates }),
  });
  if (!response.ok) throw new Error(`cart/update.js failed with ${response.status}`);
  return response.json();
}

function updateHeaderCartCount(itemCount) {
  const badge = document.querySelector('[data-cart-count]');
  if (badge) badge.textContent = String(itemCount);
}

// Cart AJAX responses return total_price as plain integer cents, not a
// pre-formatted string - Intl handles the currency symbol/format correctly
// without the theme guessing at the shop's money_format. See flight-pricing.js
// for the same "don't guess at currency" principle applied storefront-wide.
function formatMoney(cents, currency) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
}

function updateSubtotal(cart) {
  const subtotalEl = document.querySelector('[data-cart-subtotal]');
  if (!subtotalEl) return;
  subtotalEl.textContent = formatMoney(cart.total_price, cart.currency);
}

// Same gap as the subtotal: a single line's own total (unit price *
// quantity) was rendered once at page load and never refreshed after a
// quantity change - only the quantity number itself updated.
function updateLinePrice(cart, key) {
  const line = document.querySelector(`[data-cart-line][data-line-key="${key}"]`);
  const priceEl = line?.querySelector('[data-line-price]');
  const item = cart.items.find((i) => i.key === key);
  if (!priceEl || !item) return;
  priceEl.textContent = formatMoney(item.final_line_price, cart.currency);
}

function initQuantityControls() {
  document.querySelectorAll('[data-cart-line]').forEach((line) => {
    const key = line.getAttribute('data-line-key');
    const valueEl = line.querySelector('[data-quantity-value]');
    const decrease = line.querySelector('[data-quantity-decrease]');
    const increase = line.querySelector('[data-quantity-increase]');

    async function apply(delta) {
      if (!key || !valueEl) return;
      const current = parseInt(valueEl.textContent ?? '1', 10);
      const next = Math.max(0, current + delta);
      valueEl.textContent = String(next);
      try {
        const cart = await changeQuantity(key, next);
        updateHeaderCartCount(cart.item_count);
        updateSubtotal(cart);
        window.EmberAsh?.announce?.(`Quantity updated to ${next}`);
        if (next === 0) {
          line.remove();
        } else {
          updateLinePrice(cart, key);
        }
      } catch {
        valueEl.textContent = String(current);
        window.EmberAsh?.announce?.('Could not update quantity, please try again');
      }
    }

    decrease?.addEventListener('click', () => void apply(-1));
    increase?.addEventListener('click', () => void apply(1));
  });
}

function initFlightRemoval() {
  document.querySelectorAll('[data-flight-remove]').forEach((button) => {
    button.addEventListener('click', async () => {
      const keys = (button.getAttribute('data-line-keys') ?? '').split('|').filter(Boolean);
      if (keys.length === 0) return;
      const updates = {};
      keys.forEach((key) => {
        updates[key] = 0;
      });
      const group = button.closest('.cart-flight-group');
      try {
        const cart = await updateLines(updates);
        updateHeaderCartCount(cart.item_count);
        updateSubtotal(cart);
        window.EmberAsh?.announce?.('Flight removed from cart');
        group?.remove();
        if (cart.item_count === 0) window.location.reload();
      } catch {
        window.EmberAsh?.announce?.('Could not remove flight, please try again');
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initQuantityControls();
  initFlightRemoval();
});
