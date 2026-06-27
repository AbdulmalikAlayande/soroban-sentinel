import { describe, it, expect } from 'vitest';
import { decodeLedgerKey } from '../../src/core/decoder.js';
import { xdr, Address } from '@stellar/stellar-sdk';

describe('Ledger Key Decoder', () => {
  it('decodes instance key successfully', () => {
    // contract instance
    const contractId = 'CB64D3G7SM2RTH6VCGGUNMBQCBDNWZCE58A5T6L7H7J2U5GJ2X3D5CQA';
    const contractAddress = Address.fromString(contractId);

    const key = xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
      contract: contractAddress.toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent()
    }));

    const base64Key = key.toXDR('base64');
    const result = decodeLedgerKey(base64Key);

    expect(result).toMatchObject({
      contractId,
      symbol: 'ContractInstance',
      durability: 'Persistent'
    });
  });

  it('decodes data storage key successfully', () => {
    const contractId = 'CB64D3G7SM2RTH6VCGGUNMBQCBDNWZCE58A5T6L7H7J2U5GJ2X3D5CQA';
    const contractAddress = Address.fromString(contractId);

    const key = xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
      contract: contractAddress.toScAddress(),
      key: xdr.ScVal.scvSymbol('Admin'),
      durability: xdr.ContractDataDurability.temporary()
    }));

    const base64Key = key.toXDR('base64');
    const result = decodeLedgerKey(base64Key);

    expect(result).toMatchObject({
      contractId,
      symbol: 'Admin',
      durability: 'Temporary'
    });
  });
});
