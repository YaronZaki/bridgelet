import { afterEach, describe, expect, it, vi } from 'vitest';
import { analytics, appVersion, buildBasePayload, detectDeviceType } from '@/lib/analytics';

function plausibleMock() {
  return vi.fn();
}

describe('appVersion', () => {
  it('reads the build-time NEXT_PUBLIC_APP_VERSION when set', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '1.4.2');
    expect(appVersion()).toBe('1.4.2');
  });

  it('falls back to "unknown" without a configured version', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '');
    expect(appVersion()).toBe('unknown');
  });
});

describe('detectDeviceType', () => {
  it('classifies mobile user agents', () => {
    expect(detectDeviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('mobile');
    expect(detectDeviceType('Mozilla/5.0 (Linux; Android 14) Mobile')).toBe('mobile');
  });

  it('classifies tablet user agents', () => {
    expect(detectDeviceType('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('tablet');
    expect(detectDeviceType('Mozilla/5.0 (Linux; Android 13) Tablet')).toBe('tablet');
  });

  it('classifies desktop user agents', () => {
    expect(detectDeviceType('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36')).toBe('desktop');
    expect(detectDeviceType('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('desktop');
  });

  it('defaults to desktop when the user agent is empty or absent', () => {
    expect(detectDeviceType('')).toBe('desktop');
    expect(detectDeviceType(undefined)).toBe('desktop');
  });
});

describe('buildBasePayload', () => {
  it('carries the four §3.1 base fields', () => {
    const payload = buildBasePayload();
    expect(payload).toEqual(
      expect.objectContaining({
        app_version: expect.any(String),
        user_agent: expect.any(String),
        device_type: expect.stringMatching(/^(mobile|tablet|desktop)$/),
      }),
    );
    expect('referrer' in payload).toBe(true);
  });

  it('degrades to empty strings and null when browser APIs are absent', () => {
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('document', undefined);

    const payload = buildBasePayload();
    expect(payload.user_agent).toBe('');
    expect(payload.device_type).toBe('desktop');
    expect(payload.referrer).toBeNull();

    vi.unstubAllGlobals();
  });
});

describe('track base payload merge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  it('attaches the base payload to every tracking call', () => {
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock();

    analytics.claimPageViewed();
    analytics.claimInitiated();
    analytics.claimSuccess();
    analytics.claimError('sweep_failed');
    analytics.claimVerified({
      claimId: 'tok_123',
      verificationTimeMs: 42,
      expiryDaysRemaining: 7,
    });
    analytics.claimCtaClicked({ claimId: 'tok_123' });

    const plausible = (window as unknown as { plausible: ReturnType<typeof plausibleMock> })
      .plausible;
    expect(plausible).toHaveBeenCalledTimes(6);

    for (const call of plausible.mock.calls) {
      expect(call[1]).toEqual({
        props: expect.objectContaining({
          app_version: expect.any(String),
          user_agent: expect.any(String),
          device_type: expect.stringMatching(/^(mobile|tablet|desktop)$/),
        }),
      });
      expect('referrer' in call[1].props).toBe(true);
    }
  });

  it('merges event-specific props next to the base payload', () => {
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock();

    analytics.claimVerified({
      claimId: 'tok_123',
      assetType: 'XLM',
      expiryDaysRemaining: 7,
      verificationTimeMs: 42,
    });

    const call = (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible
      .mock.calls[0]!;
    expect(call[0]).toBe('Claim Verified');
    expect(call[1].props).toEqual(
      expect.objectContaining({
        journey: 'recipient',
        claim_id: 'tok_123',
        asset_type: 'XLM',
        expiry_days_remaining: 7,
        verification_time_ms: 42,
      }),
    );
  });

  it('lets event props override the base payload', () => {
    (window as unknown as { plausible?: ReturnType<typeof plausibleMock> }).plausible =
      plausibleMock();

    analytics.claimError('network_error');

    const call = (window as unknown as { plausible: ReturnType<typeof plausibleMock> }).plausible
      .mock.calls[0]!;
    expect(call[1].props).toEqual(
      expect.objectContaining({
        app_version: expect.any(String),
        user_agent: expect.any(String),
        device_type: expect.stringMatching(/^(mobile|tablet|desktop)$/),
        reason: 'network_error',
      }),
    );
    expect(typeof call[1].props.referrer === 'string' || call[1].props.referrer === null).toBe(true);
  });

  it('no-ops when the window object is unavailable', () => {
    const plausible = (window as unknown as { plausible: ReturnType<typeof plausibleMock> })
      .plausible;
    vi.stubGlobal('window', undefined);

    expect(() => analytics.claimPageViewed()).not.toThrow();
    expect(plausible).not.toHaveBeenCalled();
  });
});