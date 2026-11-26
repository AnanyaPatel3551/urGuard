import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../mocks/mockClient.ts';
import { App } from './App.tsx';

describe('App shell & routing', () => {
  it('renders sidebar routes and cluster health header for controlplane and nodes', async () => {
    const client = createMockClient();
    render(
      <MemoryRouter initialEntries={['/']}>
        <App client={client} />
      </MemoryRouter>,
    );

    expect(screen.getByText('urGuard')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Messaging' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Key Governance' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Audit Log' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Detection' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('health-controlplane')).toHaveTextContent('controlplane: READY');
      expect(screen.getByTestId('health-node-a')).toHaveTextContent('node-a: HEALTHY');
      expect(screen.getByTestId('health-node-b')).toHaveTextContent('node-b: HEALTHY');
      expect(screen.getByTestId('health-node-c')).toHaveTextContent('node-c: HEALTHY');
      expect(screen.getByTestId('active-epoch')).toHaveTextContent('epoch: 3');
    });
  });

  it('renders Key Governance and Audit Log views on their routes', async () => {
    const client = createMockClient();

    const { unmount } = render(
      <MemoryRouter initialEntries={['/governance']}>
        <App client={client} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('governance-current-epoch')).toHaveTextContent('Epoch 3');
    });
    unmount();

    render(
      <MemoryRouter initialEntries={['/audit']}>
        <App client={client} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('audit-row-1')).toBeInTheDocument();
    });
  });
});
