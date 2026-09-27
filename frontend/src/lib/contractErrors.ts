export enum ContractErrorCode {
  Unauthorized = 1,
  InsufficientBalance = 2,
  InvalidAmount = 3,
  ContractExpired = 4,
  AlreadyInitialized = 5,
  NotInitialized = 6,
  StorageKeyNotFound = 7,
  MathOverflow = 8,
  DeadlineExceeded = 9,
  InvalidSignature = 10,
  AccessDenied = 11,
}

export interface ParsedContractError {
  code: number;
  name: string;
  description: string;
  remediation: string;
}

export const CONTRACT_ERROR_REGISTRY: Record<number, Omit<ParsedContractError, 'code'>> = {
  [ContractErrorCode.Unauthorized]: {
    name: 'Unauthorized',
    description: 'The caller lacks required authorization or valid admin credentials.',
    remediation: 'Verify wallet connection and check if admin signatures are required.',
  },
  [ContractErrorCode.InsufficientBalance]: {
    name: 'InsufficientBalance',
    description: 'Target account does not possess adequate token balance to satisfy request.',
    remediation: 'Fund the account with required tokens before executing transaction.',
  },
  [ContractErrorCode.InvalidAmount]: {
    name: 'InvalidAmount',
    description: 'Supplied amount parameter is zero or negative.',
    remediation: 'Provide a positive non-zero integer amount.',
  },
  [ContractErrorCode.ContractExpired]: {
    name: 'ContractExpired',
    description: 'Target contract instance or offer deadline has expired.',
    remediation: 'Check ledger timestamp and extend TTL if necessary.',
  },
  [ContractErrorCode.AlreadyInitialized]: {
    name: 'AlreadyInitialized',
    description: 'Contract instance state has already been initialized.',
    remediation: 'Do not invoke initialize multiple times on deployed instance.',
  },
  [ContractErrorCode.NotInitialized]: {
    name: 'NotInitialized',
    description: 'Contract instance state has not been initialized yet.',
    remediation: 'Invoke initialize method before interacting with contract functions.',
  },
  [ContractErrorCode.StorageKeyNotFound]: {
    name: 'StorageKeyNotFound',
    description: 'Requested storage key or data entry does not exist in instance/persistent storage.',
    remediation: 'Ensure data entry exists before reading from storage.',
  },
  [ContractErrorCode.MathOverflow]: {
    name: 'MathOverflow',
    description: 'Arithmetic operation resulted in numerical overflow or underflow.',
    remediation: 'Check asset values and bounds before performing arithmetic operations.',
  },
  [ContractErrorCode.DeadlineExceeded]: {
    name: 'DeadlineExceeded',
    description: 'Transaction failed to complete within the specified timeout block window.',
    remediation: 'Resubmit transaction with updated block deadline.',
  },
  [ContractErrorCode.InvalidSignature]: {
    name: 'InvalidSignature',
    description: 'Ed25519 signature verification failed for provided authorization context.',
    remediation: 'Re-sign authorization payload with valid private key.',
  },
  [ContractErrorCode.AccessDenied]: {
    name: 'AccessDenied',
    description: 'Operation restricted by role-based access control (RBAC).',
    remediation: 'Request administrative role permission.',
  },
};

export function parseContractError(code: number | string): ParsedContractError {
  const numericCode = typeof code === 'string' ? parseInt(code, 10) : code;
  const match = CONTRACT_ERROR_REGISTRY[numericCode];

  if (match) {
    return {
      code: numericCode,
      ...match,
    };
  }

  return {
    code: isNaN(numericCode) ? -1 : numericCode,
    name: 'UnknownContractError',
    description: `Raw contract error code #${code} occurred.`,
    remediation: 'Inspect contract execution trace logs for detail.',
  };
}
