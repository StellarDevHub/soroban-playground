import { parseContractError, ContractErrorCode } from '../../lib/contractErrors';

describe('ContractErrors', () => {
  it('parses known raw contract error code into typed contract error', () => {
    const error = parseContractError(ContractErrorCode.InsufficientBalance);
    expect(error.name).toBe('InsufficientBalance');
    expect(error.code).toBe(2);
    expect(error.description).toBeDefined();
    expect(error.remediation).toBeDefined();
  });

  it('handles unknown raw error codes gracefully', () => {
    const error = parseContractError(999);
    expect(error.name).toBe('UnknownContractError');
    expect(error.code).toBe(999);
    expect(error.remediation).toContain('Inspect contract execution trace logs');
  });

  it('parses string error codes accurately', () => {
    const error = parseContractError('8');
    expect(error.name).toBe('MathOverflow');
    expect(error.code).toBe(8);
  });
});
