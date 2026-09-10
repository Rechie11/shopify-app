import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type DashboardSummary, acknowledgeAlert, getDashboardSummary } from '../lib/api.js';

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function describeActivity(entry: DashboardSummary['recentActivity'][number]): string {
  return `${entry.actorLabel} · ${entry.action.replace(/[._]/g, ' ')}`;
}

export function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    getDashboardSummary()
      .then(setSummary)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load dashboard'),
      );
  }

  useEffect(load, []);

  async function handleAcknowledge(id: number) {
    await acknowledgeAlert(id);
    load();
  }

  if (error) {
    return (
      <div className="page">
        <div className="error-banner">{error}</div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="page">
        <p className="muted">Loading...</p>
      </div>
    );
  }

  const { bundleCounts, scoreDistribution, openAlerts, recentActivity } = summary;

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Dashboard</h1>
        <Link className="button button--primary" to="/bundles">
          View bundles
        </Link>
      </div>

      <div className="kpi-row">
        <div className="card kpi-tile">
          <span className="kpi-tile__value">{bundleCounts.active}</span>
          <span className="kpi-tile__label">Active bundles</span>
        </div>
        <div className="card kpi-tile kpi-tile--healthy">
          <span className="kpi-tile__value">{scoreDistribution.healthy}</span>
          <span className="kpi-tile__label">Healthy</span>
        </div>
        <div className="card kpi-tile kpi-tile--watch">
          <span className="kpi-tile__value">{scoreDistribution.watch}</span>
          <span className="kpi-tile__label">Watch</span>
        </div>
        <div className="card kpi-tile kpi-tile--at-risk">
          <span className="kpi-tile__value">{scoreDistribution.at_risk}</span>
          <span className="kpi-tile__label">At risk</span>
        </div>
      </div>

      <h2 className="section-title">Open alerts</h2>
      <div className="card" style={{ padding: openAlerts.length ? 0 : undefined }}>
        {openAlerts.length === 0 && (
          <p className="empty-state">No open alerts. Everything is healthy.</p>
        )}
        {openAlerts.map((alert) => (
          <div className={`item-row item-row--severity-${alert.severity}`} key={alert.id}>
            <span className={`badge badge--severity-${alert.severity}`}>{alert.severity}</span>
            <div style={{ flex: 1 }}>
              <div className="item-row__title">{alert.title}</div>
              {alert.body && <div className="item-row__meta">{alert.body}</div>}
            </div>
            <button className="button" onClick={() => void handleAcknowledge(alert.id)}>
              Acknowledge
            </button>
          </div>
        ))}
      </div>

      <h2 className="section-title">Recent activity</h2>
      <div className="card" style={{ padding: recentActivity.length ? 0 : undefined }}>
        {recentActivity.length === 0 && <p className="empty-state">Nothing has happened yet.</p>}
        {recentActivity.map((entry) => (
          <div className="item-row" key={entry.id}>
            <span className="item-row__title">{describeActivity(entry)}</span>
            <span className="item-row__meta">{timeAgo(entry.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
