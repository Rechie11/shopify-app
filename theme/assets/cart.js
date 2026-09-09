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
        window.EmberAsh?.announce?.(`Quantity updated to ${next}`);
        if (next === 0) {
          line.remove();
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
