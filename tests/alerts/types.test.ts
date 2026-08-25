import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeSeverity, computeResourceSeverity } from '../../src/alerts/types';

const validSeverities = ['critical', 'warning', 'info'] as const;

describe('computeSeverity', () => {
  it('always returns a valid severity for any non-negative TTL and positive threshold', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1e6, noNaN: true }),
        fc.float({ min: 1e-6, max: 1e6, noNaN: true }),
        (remainingTTL, thresholdLedgers) => {
          const severity = computeSeverity(remainingTTL, thresholdLedgers);
          expect(validSeverities).toContain(severity);
        }
      );
    );
  });

  it('classifies severity based on the 25% and 100% boundaries', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1e6, noNaN: true }),
        fc.float({ min: 1e-6, max: 1e6, noNaN: true }),
        (remainingTTL, thresholdLedgers) => {
          const expected = remainingTTL <= thresholdLedgers * 0.25
            ? 'critical'
            : remainingTTL <= thresholdLedgers
              ? 'warning'
              : 'info';
          expect(computeSeverity(remainingTTL, thresholdLedgers)).toBe(expected);
        }
      );
    );
  });

  it('returns critical when remainingTTL is exactly 25% of threshold', () => {
    expect(computeSeverity(25, 100)).toBe('critical');
    expect(computeSeverity(0.025, 0.1)).toBe('critical');
    expect(computeSeverity(0.75, 3)).toBe('critical');
  });

  it('returns warning when remainingTTL is just above 25% and at or below 100% of threshold', () => {
    expect(computeSeverity(25.000001, 100)).toBe('warning');
    expect(computeSeverity(0.026, 0.1)).toBe('warning');
    expect(computeSeverity(100, 100)).toBe('warning');
  });

  it('returns info when remainingTTL is above the threshold', () => {
    expect(computeSeverity(101, 100)).toBe('info');
    expect(computeSeverity(0.11, 0.1)).toBe('info');
  });
});

describe('computeResourceSeverity', () => {
  it('always returns a valid severity for any usage percentage between 0 and 100', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 100, noNaN: true }),
        (usagePercent) => {
          const severity = computeResourceSeverity(usagePercent);
          expect(validSeverities).toContain(severity);
        }
      );
    );
  });

  it('classifies severity based on the 80% and 95% boundaries', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 100, noNaN: true }),
        (usagePercent) => {
          const expected = usagePercent >= 95
            ? 'critical'
            : usagePercent >= 80
              ? 'warning'
              : 'info';
          expect(computeResourceSeverity(usagePercent)).toBe(expected);
        }
      );
    );
  });

  it('returns warning when usage is exactly |Е', () => {
    expect(computeResourceSeverity(80)).toBe('warning');
  });

  it('returns info when usage is just below 80%', () => {
    expect(computeResourceSeverity(79.999)).toBe('info');
  });

  it('returns warning when usage is between 80% and 95', () => {
    expect(computeResourceSeverity(80.001)).toBe('warning');
    expect(computeResourceSeverity(94.999)).toBe('warning');
  });

  it('returns critical when usage is exactly 95% or above', () => {
    expect(computeResourceSeverity(95)).toBe('critical');
    expect(computeResourceSeverity(95.001)).toBe('critical');
  });
});
