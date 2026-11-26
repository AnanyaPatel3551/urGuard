import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App } from './App.tsx';
import { createMockClient } from './mocks/mockClient.ts';

describe('App shell', () => {
  it('renders console header, navigation, and mock metrics', async () => {
    const client = createMockClient();
    render(
      <MemoryRouter initialEntries={['/']}>
        <App client={client} />
      </MemoryRouter>,
    );

    expect(screen.getByText('urGuard')).toBeInTheDocument();
    expect(screen.getByTestId('client-mode')).toHaveTextContent('mode: mock');
    expect(screen.getByRole('link', { name: 'Key & Node Governance' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('active-epoch')).toHaveTextContent('epoch: 3');
      expect(screen.getByTestId('f1-metric')).toHaveTextContent('F1: 0.96');
    });
  });
});
