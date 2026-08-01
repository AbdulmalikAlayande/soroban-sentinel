import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { decodeLedgerKey } from '../../src/core/decoder';

describe('decoder fuzz tests', () => {
  it('should never throw an uncaught exception for random base64 strings', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 1000 }), (str) => {
        try {
          const base64Str = Buffer.from(str).toString('base64');
          decodeLedgerKey(base64Str);
        } catch (e) {
          // If it throws, it should be a standard Error
          expect(e).toBeInstanceOf(Error);
        }
        return true;
      }),
      { numRuns: 1000 }
    );
  });
});
