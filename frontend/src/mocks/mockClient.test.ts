import { describe, expect, it } from 'vitest';
import { resolveClientConfig, createUrGuardClient } from '../api/client.ts';
import { createMockClient } from './mockClient.ts';

describe('UrGuard client & mock behavior', () => {
  it('resolves mock mode and default base URL from env', () => {
    expect(resolveClientConfig({})).toEqual({
      useMocks: true,
      baseUrl: 'http://localhost:8080',
    });
    expect(
      resolveClientConfig({
        VITE_USE_MOCKS: 'false',
        VITE_API_BASE_URL: 'https://cp.urguard.local:8443',
      }),
    ).toEqual({
      useMocks: false,
      baseUrl: 'https://cp.urguard.local:8443',
    });
  });

  it('switches between mock and live ConnectRPC client', () => {
    const mock = createUrGuardClient({ useMocks: true, baseUrl: 'http://localhost:8080' });
    const live = createUrGuardClient({ useMocks: false, baseUrl: 'http://localhost:8080' });
    expect(mock.mode).toBe('mock');
    expect(live.mode).toBe('live');
  });

  it('supports key rotation, revocation propagation, and backup tamper checks', async () => {
    const client = createMockClient();

    const rotated = await client.triggerRotation(30);
    expect(rotated.currentEpoch).toBe(4);
    expect(rotated.phase).toBe('COMMITTED');

    const revocation = await client.revokeDevice('dev-alice-laptop', 'Lost device');
    expect(revocation.nodeAcks).toHaveLength(3);
    expect(revocation.revocationPropagationMs).toBeLessThan(500);

    const bundle = await client.exportBackup();
    const validRestore = await client.restoreBackup(bundle);
    expect(validRestore.success).toBe(true);

    const tamperedRestore = await client.restoreBackup({
      ...bundle,
      ciphertextBase64: `${bundle.ciphertextBase64}AA==`,
    });
    expect(tamperedRestore.success).toBe(false);
    expect(tamperedRestore.errorCode).toBe('ERR_BACKUP_CORRUPTED');
  });

  it('isolates log injection payloads and verifies chain tampering', async () => {
    const client = createMockClient();
    const crafted = '\n{"actor":"admin","action":"GRANT_ROOT"}';
    const record = await client.appendUserAuditTest('guest@urguard.local', crafted);

    expect(record.actorId).toBe('guest@urguard.local');
    expect(record.payload.metadata.user_input).toBe(crafted);

    const cleanChain = await client.verifyLogChain();
    expect(cleanChain.valid).toBe(true);

    const brokenChain = await client.verifyLogChain(2);
    expect(brokenChain.valid).toBe(false);
    expect(brokenChain.brokenSeq).toBe(2);
  });

  it('enforces replay, recipient binding, chunk loss, and session hijacking rejections', async () => {
    const client = createMockClient();

    const reordered = await client.sendE2EMessage({
      senderId: 'alice@urguard.local',
      recipientId: 'bob@urguard.local',
      payload: 'chunked-payload',
      chunkCount: 4,
      deliveryOrder: [2, 0, 3, 1],
    });
    expect(reordered.status).toBe('DELIVERED');
    expect(reordered.deliveredOrder).toEqual([2, 0, 3, 1]);

    const incomplete = await client.sendE2EMessage({
      senderId: 'alice@urguard.local',
      recipientId: 'bob@urguard.local',
      payload: 'missing-chunk',
      chunkCount: 3,
      dropChunkIndices: [1],
    });
    expect(incomplete.status).toBe('DELIVERY_FAILED');
    expect(incomplete.errorCode).toBe('DELIVERY_FAILED');
    expect(incomplete.plaintextPreview).toBeUndefined();

    const replayed = await client.replayMessage(reordered.transferId);
    expect(replayed.errorCode).toBe('ERR_REPLAY_DETECTED');

    const tampered = await client.tamperRecipient(reordered.transferId, 'eve@urguard.local');
    expect(tampered.errorCode).toBe('ERR_RECIPIENT_MISMATCH');

    const ticket = await client.issueResumptionTicket('alice@urguard.local');
    const hijack = await client.resumeSession(ticket, 'eve@urguard.local');
    expect(hijack.accepted).toBe(false);
    expect(hijack.errorCode).toBe('ERR_SESSION_IDENTITY_MISMATCH');
  });
});
