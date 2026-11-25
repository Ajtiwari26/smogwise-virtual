import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Vercel dynamic CORS origin allowlist', () => {
  it('allows Origin matching VERCEL_PROJECT_PRODUCTION_URL over https on GET /api/health', async () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'smogwise-virtual.vercel.app');

    const res = await request(createApp())
      .get('/api/health')
      .set('Origin', 'https://smogwise-virtual.vercel.app');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://smogwise-virtual.vercel.app',
    );
  });

  it('rejects untrusted Origin without access-control-allow-origin header', async () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'smogwise-virtual.vercel.app');

    const res = await request(createApp())
      .get('/api/health')
      .set('Origin', 'https://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not promote invalid VERCEL_URL values like localhost or 127.0.0.1 to https origins', async () => {
    for (const invalidHost of ['localhost', '127.0.0.1']) {
      vi.stubEnv('VERCEL_URL', invalidHost);

      const res = await request(createApp())
        .get('/api/health')
        .set('Origin', `https://${invalidHost}`);

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      vi.unstubAllEnvs();
    }
  });
});
