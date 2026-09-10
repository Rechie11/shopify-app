import { useEffect, useState } from 'react';
import { type BundleScore, getScoreHistory } from '../lib/api.js';

function pct(value: string | null): number {
  return value == null ? 0 : Math.max(0, Math.min(100, parseFloat(value)));
}

function bandFor(value: number): 'healthy' | 'watch' | 'at_risk' {
  if (value >= 75) return 'healthy';
  if (value >= 50) return 'watch';
  return 'at_risk';
}

function BreakdownRow({ label, value }: { label: string; value: string | null }) {
  const numeric = pct(value);
  return (
    <div className="score-breakdown__row">
      <span className="muted">{label}</span>
      <div className="score-breakdown__bar">
        <div
          className={`score-breakdown__bar-fill score-breakdown__bar-fill--${bandFor(numeric)}`}
          style={{ width: `${numeric}%` }}
        />
      </div>
      <span>{value == null ? '—' : Math.round(parseFloat(value))}</span>
    </div>
  );
}

export function HealthCard({ publicId }: { publicId: string }) {
  const [history, setHistory] = useState<BundleScore[] | null>(null);

  useEffect(() => {
    getScoreHistory(publicId)
      .then((res) => setHistory(res.history))
      .catch(() => setHistory([]));
  }, [publicId]);

  if (history === null) {
    return null;
  }
  if (history.length === 0) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>
          Bundle Health Score
        </h2>
        <p className="empty-state">No score yet. It's computed once the bundle is active.</p>
      </div>
    );
  }

  const latest = history[0]!;
  // Oldest first for the sparkline's left-to-right trend reading.
  const trend = [...history].reverse();
  const maxScore = Math.max(...trend.map((h) => parseFloat(h.score)), 1);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>
        Bundle Health Score
      </h2>

      <div className="score-gauge">
        <span className={`score-gauge__value score-gauge__value--${latest.band}`}>
          {Math.round(parseFloat(latest.score))}
        </span>
        <span
          className={`badge badge--${latest.band === 'at_risk' ? 'archived' : latest.band === 'watch' ? 'paused' : 'active'}`}
        >
          {latest.band.replace('_', ' ')}
        </span>
      </div>

      {latest.primaryReason && <p>{latest.primaryReason}</p>}

      <div className="score-breakdown">
        <BreakdownRow label="Inventory" value={latest.inventoryScore} />
        <BreakdownRow label="Margin" value={latest.marginScore} />
        <BreakdownRow label="Traction" value={latest.tractionScore} />
        <BreakdownRow label="Balance" value={latest.balanceScore} />
      </div>

      {trend.length > 1 && (
        <div className="sparkline">
          {trend.map((h) => (
            <div
              key={h.id}
              className="sparkline__bar"
              style={{ height: `${Math.max(4, (parseFloat(h.score) / maxScore) * 40)}px` }}
              title={`${Math.round(parseFloat(h.score))} on ${new Date(h.computedAt).toLocaleString()}`}
            />
          ))}
        </div>
      )}

      {latest.recommendedAction && (
        <div className="recommendation">
          <strong>Suggested:</strong> swap in {latest.recommendedAction.swapInProductTitle} (
          {Math.round(latest.recommendedAction.daysOfCover)} days cover, same heat tier).
        </div>
      )}
    </div>
  );
}
