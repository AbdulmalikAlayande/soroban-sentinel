import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { xdr } from '@stellar/stellar-sdk';
import { scvalToJSON } from '../../src/core/scvalTranslator';

describe('scvalTranslator fuzz tests', () => {
  it('should never throw an uncaught exception for random XDR bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1024 }), (bytes) => {
        let val: xdr.ScVal;
        try {
          val = xdr.ScVal.fromXDR(Buffer.from(bytes));
        } catch (e) {
          // If it's not valid XDR, we don't care, we want to test scvalToJSON
          return true;
        }

        try {
          scvalToJSON(val);
        } catch (e) {
          // It's allowed to throw, but it should be a standard Error
          expect(e).toBeInstanceOf(Error);
        }
        return true;
      }),
      { numRuns: 1000 }
    );
  });
});
