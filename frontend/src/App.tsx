import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import { urGuardClient, type UrGuardClient } from './api/client.ts';
import type { DetectionMetrics, SystemHealth } from './api/types.ts';

interface AppProps {
  readonly client?: UrGuardClient;
}

interface OverviewPanelProps {
  readonly title: string;
  readonly summary: string;
  readonly details: readonly string[];
}

function OverviewPanel({ title, summary, details }: OverviewPanelProps) {
  return (
    <section className="panel" aria-label={title}>
      <h2>{title}</h2>
      <p className="panel-summary">{summary}</p>
      <ul className="panel-list">
        {details.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

/** Root operator console shell with navigation across the four Track 4 workflows. */
export function App({ client = urGuardClient }: AppProps) {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [metrics, setMetrics] = useState<DetectionMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadSummary() {
      try {
        const [nextHealth, nextMetrics] = await Promise.all([
          client.getSystemHealth(),
          client.getMetrics(),
        ]);
        if (!active) return;
        setHealth(nextHealth);
        setMetrics(nextMetrics);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load control plane status');
      }
    }
    void loadSummary();
    return () => {
      active = false;
    };
  }, [client]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-title">urGuard</span>
          <span className="brand-subtitle">Post-Quantum Zero-Trust Operator Console</span>
        </div>
        <div className="status-strip">
          <span className="badge" data-testid="client-mode">
            mode: {client.mode}
          </span>
          <span className="badge" data-testid="active-epoch">
            epoch: {health ? health.rotation.currentEpoch : '--'}
          </span>
          <span className="badge" data-testid="f1-metric">
            F1: {metrics ? metrics.f1Score.toFixed(2) : '--'}
          </span>
        </div>
      </header>

      <nav className="nav" aria-label="Console sections">
        <NavLink
          to="/"
          end
          className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
        >
          E2E Messaging
        </NavLink>
        <NavLink
          to="/governance"
          className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
        >
          Key &amp; Node Governance
        </NavLink>
        <NavLink
          to="/audit"
          className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
        >
          Audit Log &amp; Integrity
        </NavLink>
        <NavLink
          to="/detection"
          className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
        >
          Detection &amp; Graph
        </NavLink>
      </nav>

      <main className="main-content">
        {error ? (
          <div className="error-banner" role="alert">
            {error}
          </div>
        ) : null}

        <Routes>
          <Route
            path="/"
            element={
              <OverviewPanel
                title="E2E Messaging & File Transfer"
                summary="Hybrid X25519 + ML-KEM-768 envelope encryption with AES-256-GCM AAD recipient binding and ML-DSA-65 signatures."
                details={[
                  `Active relay nodes: ${health ? String(health.nodes.length) : '0'}`,
                  `Current epoch: ${health ? String(health.rotation.currentEpoch) : '--'} (${health ? health.rotation.phase : 'loading'})`,
                  `PQC handshake latency: ${metrics ? `${String(metrics.pqcHandshakeLatencyMs)} ms` : '--'}`,
                ]}
              />
            }
          />
          <Route
            path="/governance"
            element={
              <OverviewPanel
                title="Key & Node Governance"
                summary="Two-phase WAL key rotation with 30s grace period, streaming CRL revocation, device re-enrollment, and signed backup verification."
                details={[
                  `Grace period: ${health ? `${String(health.rotation.gracePeriodSeconds)} s` : '--'}`,
                  `Revocation propagation: ${metrics ? `${String(metrics.revocationPropagationMs)} ms` : '--'}`,
                  `Control plane target: ${client.baseUrl}`,
                ]}
              />
            }
          />
          <Route
            path="/audit"
            element={
              <OverviewPanel
                title="Audit Log & Integrity"
                summary="Canonical SHA-256 hash-chained audit records with ML-DSA-65 signed checkpoints and injection-safe metadata isolation."
                details={[
                  'Verification endpoint: VerifyLogChain()',
                  'Canonical JSON framing isolates user-supplied fields',
                ]}
              />
            }
          />
          <Route
            path="/detection"
            element={
              <OverviewPanel
                title="Security Detection & Access Graph"
                summary="Deterministic rule engine, bounded-watermark clock-skew handling, and identity-service lateral movement graph (zero AI/ML)."
                details={[
                  `Precision / Recall / F1: ${metrics ? `${metrics.precision.toFixed(2)} / ${metrics.recall.toFixed(2)} / ${metrics.f1Score.toFixed(2)}` : '--'}`,
                  `Median time to alert: ${metrics ? `${String(metrics.medianTimeToAlertMs)} ms` : '--'}`,
                  `False alerts / 1k benign: ${metrics ? String(metrics.falseAlertsPer1kBenign) : '--'}`,
                  `Clock skew bound: ±${metrics ? String(metrics.maxClockSkewSeconds) : '--'} s`,
                ]}
              />
            }
          />
        </Routes>
      </main>
    </div>
  );
}
