import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  type BundleWithDetails,
  createBundle,
  deleteBundle,
  getBundle,
  pauseBundle,
  publishBundle,
  saveComposition,
  updateBundle,
} from '../lib/api.js';
import { type PickedVariant, ProductPicker } from '../components/ProductPicker.js';

interface DraftItem {
  productGid: string;
  variantGid: string;
  productTitleCache: string;
  variantTitleCache: string;
  unitPriceCents: number;
}

interface DraftTier {
  minQuantity: number;
  discountBps: number;
}

export function BundleEditor() {
  const { publicId } = useParams<{ publicId: string }>();
  const navigate = useNavigate();
  const isNew = publicId === 'new';

  const [bundle, setBundle] = useState<BundleWithDetails | null>(null);
  const [title, setTitle] = useState('');
  const [handle, setHandle] = useState('');
  const [minItems, setMinItems] = useState(3);
  const [maxItems, setMaxItems] = useState(6);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [tiers, setTiers] = useState<DraftTier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew || !publicId) return;
    getBundle(publicId)
      .then((b) => {
        setBundle(b);
        setTitle(b.title);
        setHandle(b.handle);
        setMinItems(b.minItems);
        setMaxItems(b.maxItems);
        setItems(
          b.items.map((i) => ({
            productGid: i.productGid,
            variantGid: i.variantGid,
            productTitleCache: i.productTitleCache ?? '',
            variantTitleCache: i.variantTitleCache ?? '',
            unitPriceCents: i.unitPriceCents ?? 0,
          })),
        );
        setTiers(b.tiers.map((t) => ({ minQuantity: t.minQuantity, discountBps: t.discountBps })));
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load bundle'),
      );
  }, [isNew, publicId]);

  async function handleCreate() {
    setError(null);
    setSaving(true);
    try {
      const created = await createBundle({
        handle:
          handle ||
          title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, ''),
        title,
        minItems,
        maxItems,
        pricingMode: 'tiered_percent',
      });
      navigate(`/bundles/${created.publicId}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create bundle');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDetails() {
    if (!bundle) return;
    setError(null);
    setSaving(true);
    try {
      await updateBundle(bundle.publicId, { title, minItems, maxItems });
      setBundle({ ...bundle, title, minItems, maxItems });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save bundle');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveComposition() {
    if (!bundle) return;
    setError(null);
    setSaving(true);
    try {
      await saveComposition(bundle.publicId, {
        items: items.map((item, position) => ({ ...item, position, isRequired: true })),
        tiers,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save composition');
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!bundle) return;
    setError(null);
    setSaving(true);
    try {
      await publishBundle(bundle.publicId);
      const refreshed = await getBundle(bundle.publicId);
      setBundle(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish bundle');
    } finally {
      setSaving(false);
    }
  }

  async function handlePause() {
    if (!bundle) return;
    setError(null);
    setSaving(true);
    try {
      await pauseBundle(bundle.publicId);
      const refreshed = await getBundle(bundle.publicId);
      setBundle(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause bundle');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!bundle) return;
    if (!confirm(`Delete "${bundle.title}"? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await deleteBundle(bundle.publicId);
      navigate('/bundles');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete bundle');
      setSaving(false);
    }
  }

  function addItem(variant: PickedVariant) {
    if (items.some((i) => i.variantGid === variant.variantGid)) return;
    setItems([...items, variant]);
  }

  function removeItem(variantGid: string) {
    setItems(items.filter((i) => i.variantGid !== variantGid));
  }

  function addTier() {
    setTiers([...tiers, { minQuantity: minItems, discountBps: 1000 }]);
  }

  function updateTier(index: number, patch: Partial<DraftTier>) {
    setTiers(tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function removeTier(index: number) {
    setTiers(tiers.filter((_, i) => i !== index));
  }

  if (isNew) {
    return (
      <div className="page">
        <div className="page__header">
          <h1 className="page__title">New bundle</h1>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <div className="card">
          <div className="field">
            <label htmlFor="title">Title</label>
            <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="handle">Handle</label>
            <input
              id="handle"
              placeholder="auto-generated from title if left blank"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="minItems">Minimum bottles</label>
              <input
                id="minItems"
                type="number"
                min={1}
                value={minItems}
                onChange={(e) => setMinItems(Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label htmlFor="maxItems">Maximum bottles</label>
              <input
                id="maxItems"
                type="number"
                min={1}
                value={maxItems}
                onChange={(e) => setMaxItems(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="form-actions">
            <button
              className="button button--primary"
              disabled={!title || saving}
              onClick={handleCreate}
            >
              Create draft
            </button>
            <button className="button" onClick={() => navigate('/bundles')}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="page">
        {error ? <div className="error-banner">{error}</div> : <p className="muted">Loading...</p>}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">{bundle.title}</h1>
        <span className={`badge badge--${bundle.status}`}>{bundle.status}</span>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="field">
          <label htmlFor="edit-title">Title</label>
          <input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="edit-min">Minimum bottles</label>
            <input
              id="edit-min"
              type="number"
              min={1}
              value={minItems}
              onChange={(e) => setMinItems(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-max">Maximum bottles</label>
            <input
              id="edit-max"
              type="number"
              min={1}
              value={maxItems}
              onChange={(e) => setMaxItems(Number(e.target.value))}
            />
          </div>
        </div>
        <button className="button" disabled={saving} onClick={() => void handleSaveDetails()}>
          Save details
        </button>

        <h2 className="section-title">Components</h2>
        {items.length === 0 && <p className="empty-state">No products added yet.</p>}
        {items.map((item) => (
          <div className="item-row" key={item.variantGid}>
            <span className="item-row__title">
              {item.productTitleCache}
              {item.variantTitleCache && item.variantTitleCache !== 'Default Title'
                ? ` — ${item.variantTitleCache}`
                : ''}
            </span>
            <span className="item-row__meta">${(item.unitPriceCents / 100).toFixed(2)}</span>
            <button className="button" onClick={() => removeItem(item.variantGid)}>
              Remove
            </button>
          </div>
        ))}
        <ProductPicker onPick={addItem} />

        <h2 className="section-title">Price tiers</h2>
        {tiers.length === 0 && <p className="empty-state">No price tiers yet.</p>}
        {tiers.map((tier, i) => (
          <div className="item-row" key={i}>
            <span className="muted">Buy</span>
            <input
              type="number"
              min={1}
              style={{ width: 70 }}
              value={tier.minQuantity}
              onChange={(e) => updateTier(i, { minQuantity: Number(e.target.value) })}
            />
            <span className="muted">get</span>
            <input
              type="number"
              min={0}
              max={100}
              style={{ width: 70 }}
              value={tier.discountBps / 100}
              onChange={(e) => updateTier(i, { discountBps: Number(e.target.value) * 100 })}
            />
            <span className="muted">% off</span>
            <div style={{ flex: 1 }} />
            <button className="button" onClick={() => removeTier(i)}>
              Remove
            </button>
          </div>
        ))}
        <button className="button" onClick={addTier}>
          Add tier
        </button>

        <div className="form-actions">
          <button
            className="button button--primary"
            disabled={saving}
            onClick={() => void handleSaveComposition()}
          >
            Save composition
          </button>
        </div>

        <h2 className="section-title">Publishing</h2>
        <div className="form-actions">
          {bundle.status !== 'active' && (
            <button
              className="button button--primary"
              disabled={saving}
              onClick={() => void handlePublish()}
            >
              Publish
            </button>
          )}
          {bundle.status === 'active' && (
            <button className="button" disabled={saving} onClick={() => void handlePause()}>
              Pause
            </button>
          )}
          <button
            className="button button--danger"
            disabled={saving}
            onClick={() => void handleDelete()}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
