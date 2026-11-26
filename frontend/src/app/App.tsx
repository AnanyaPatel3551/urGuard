import { useCallback } from 'react';
import { Route, Routes } from 'react-router';
import { urGuardClient, type UrGuardClient } from '../api/client.ts';
import type { SystemHealth } from '../api/types.ts';
import { Card } from '../components/Card.tsx';
import { useSubscription } from '../hooks/useSubscription.ts';
import { AuditView } from '../views/audit/AuditView.tsx';
import { GovernanceView } from '../views/governance/GovernanceView.tsx';
import { AppShell } from './AppShell.tsx';

interface AppProps {
  readonly client?: UrGuardClient;
}

interface PlaceholderViewProps {
  readonly title: string;
  readonly subtitle: string;
  readonly items: readonly string[];
}

function PlaceholderView({ title, subtitle, items }: PlaceholderViewProps) {
  return (
    <Card title={title} subtitle={subtitle}>
      <ul className="panel-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </Card>
  );
}

/** Root application router wiring the 4 operator console views. */
export function App({ client = urGuardClient }: AppProps) {
  const subscribeHealth = useCallback(
    (handlers: Parameters<UrGuardClient['subscribeSystemHealth']>[0]) =>
      client.subscribeSystemHealth(handlers),
    [client],
  );

  const { data: health, status: streamStatus } = useSubscription<SystemHealth>(subscribeHealth, [
    client,
  ]);

  return (
    <AppShell mode={client.mode} health={health} streamStatus={streamStatus}>
      <Routes>
        <Route
          path="/"
          element={
            <PlaceholderView
              title="E2E Messaging & File Transfer"
              subtitle="Scheduled for Phase 2 — Hybrid X25519 + ML-KEM-768 envelope transfer, chunk loss/reordering, replay & recipient-binding diagnostics."
              items={[
                `Active relay nodes: ${health ? String(health.nodes.length) : '0'}`,
                `Current key epoch: ${health ? String(health.rotation.currentEpoch) : '--'}`,
                'Ephemeral session key zeroization and peer-bound ResumptionTicket checks',
              ]}
            />
          }
        />
        <Route path="/governance" element={<GovernanceView client={client} />} />
        <Route path="/audit" element={<AuditView client={client} />} />
        <Route
          path="/detection"
          element={
            <PlaceholderView
              title="Security Detection & Access Graph"
              subtitle="Scheduled for Phase 2 — Deterministic rules, ±30s watermark clock-skew handling, and lateral movement graph."
              items={[
                'Zero AI/ML dependencies — rule-based & statistical baselines only',
                'Interactive identity -> service -> enclave lateral movement graph',
                'Live Precision, Recall, F1, median alert latency & false-alert KPIs',
              ]}
            />
          }
        />
      </Routes>
    </AppShell>
  );
}
