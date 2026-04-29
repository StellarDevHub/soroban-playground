// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { 
  Server,
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
  Account,
  BASE_FEE
} from 'stellar-sdk';
import { logger } from '../utils/logger.js';
import { cacheGet, cacheSet } from '../utils/cache.js';

// Network configuration
const NETWORKS_CONFIG = {
  testnet: {
    server: new Server('https://horizon-testnet.stellar.org'),
    network: Networks.TESTNET,
    passphrase: 'Test SDF Network ; September 2015',
  },
  mainnet: {
    server: new Server('https://horizon.stellar.org'),
    network: Networks.PUBLIC,
    passphrase: 'Public Global Stellar Network ; September 2015',
  },
  futurenet: {
    server: new Server('https://horizon-futurenet.stellar.org'),
    network: Networks.FUTURENET,
    passphrase: 'Test SDF Future Network ; October 2022',
  },
};

/**
 * Get Stellar server for the specified network
 */
function getServer(network = 'testnet') {
  const config = NETWORKS_CONFIG[network];
  if (!config) {
    throw new Error(`Unsupported network: ${network}`);
  }
  return config.server;
}

/**
 * Get network passphrase for the specified network
 */
function getNetworkPassphrase(network = 'testnet') {
  const config = NETWORKS_CONFIG[network];
  if (!config) {
    throw new Error(`Unsupported network: ${network}`);
  }
  return config.passphrase;
}

/**
 * Deploy a smart contract to the Stellar network
 */
export async function deployContract(options) {
  const { wasmBuffer, sourceKeypair, network = 'testnet' } = options;
  
  try {
    logger.info('Deploying smart contract', { network });

    const server = getServer(network);
    const sourceAccount = await server.loadAccount(sourceKeypair.publicKey());
    
    // Create deploy contract operation
    const contractOp = Operation.deployContract({
      wasm: wasmBuffer,
    });

    // Build and sign transaction
    const transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: getNetworkPassphrase(network),
    })
      .addOperation(contractOp)
      .setTimeout(30)
      .build();

    transaction.sign(sourceKeypair);

    // Submit transaction
    const result = await server.submitTransaction(transaction);
    
    if (!result.successful) {
      throw new Error(`Transaction failed: ${result.resultXdr}`);
    }

    // Extract contract address from result
    const contractAddress = result.resultMeta.operations[0].deployContractResult.address;
    
    logger.info('Contract deployed successfully', { 
      contractAddress, 
      network,
      transactionHash: result.hash 
    });

    return {
      contractAddress,
      transactionHash: result.hash,
      network,
    };
  } catch (error) {
    logger.error('Failed to deploy contract', { network, error: error.message });
    throw new Error(`Failed to deploy contract: ${error.message}`);
  }
}

/**
 * Invoke a smart contract method
 */
export async function invokeContract(options) {
  const { 
    contractId, 
    method, 
    args = [], 
    sourceKeypair, 
    network = 'testnet',
    simulateOnly = false 
  } = options;
  
  try {
    logger.info('Invoking smart contract', { contractId, method, network, simulateOnly });

    const server = getServer(network);
    const sourceAccount = await server.loadAccount(sourceKeypair.publicKey());
    
    // Create invoke contract operation
    const invokeOp = Operation.invokeContractFunction({
      contract: contractId,
      function: method,
      args: args,
    });

    // Build and sign transaction
    const transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: getNetworkPassphrase(network),
    })
      .addOperation(invokeOp)
      .setTimeout(30)
      .build();

    transaction.sign(sourceKeypair);

    if (simulateOnly) {
      // Simulate transaction without submitting
      const simulation = await server.simulateTransaction(transaction);
      return {
        success: true,
        simulation,
        result: simulation.result,
      };
    }

    // Submit transaction
    const result = await server.submitTransaction(transaction);
    
    if (!result.successful) {
      throw new Error(`Transaction failed: ${result.resultXdr}`);
    }

    // Parse contract result
    const contractResult = result.resultMeta.operations[0].invokeHostFunctionResult;
    
    logger.info('Contract invoked successfully', { 
      contractId, 
      method, 
      network,
      transactionHash: result.hash 
    });

    return {
      success: true,
      result: contractResult,
      transactionHash: result.hash,
    };
  } catch (error) {
    logger.error('Failed to invoke contract', { contractId, method, network, error: error.message });
    throw new Error(`Failed to invoke contract: ${error.message}`);
  }
}

/**
 * Get contract events
 */
export async function getContractEvents(options) {
  const { 
    contractId, 
    fromLedger, 
    toLedger, 
    limit = 100, 
    network = 'testnet' 
  } = options;
  
  try {
    logger.info('Getting contract events', { contractId, fromLedger, toLedger, limit, network });

    const server = getServer(network);
    
    // Build event query
    let eventsRequest = server.events()
      .forContract(contractId)
      .limit(limit);

    if (fromLedger) {
      eventsRequest = eventsRequest.fromLedger(fromLedger);
    }

    if (toLedger) {
      eventsRequest = eventsRequest.toLedger(toLedger);
    }

    const events = await eventsRequest.call();
    
    logger.info('Contract events retrieved successfully', { 
      contractId, 
      count: events.records.length 
    });

    return {
      events: events.records,
      pagination: {
        limit,
        hasMore: events.records.length === limit,
      },
    };
  } catch (error) {
    logger.error('Failed to get contract events', { contractId, network, error: error.message });
    throw new Error(`Failed to get contract events: ${error.message}`);
  }
}

/**
 * Get contract data (state)
 */
export async function getContractData(options) {
  const { 
    contractId, 
    key, 
    durability = 'persistent', 
    network = 'testnet' 
  } = options;
  
  try {
    logger.info('Getting contract data', { contractId, key, durability, network });

    const server = getServer(network);
    
    // Build data request
    let dataRequest = server.contracts()
      .getContractData({
        contract: contractId,
        key: key || null,
        durability: durability,
      });

    const data = await dataRequest.call();
    
    logger.info('Contract data retrieved successfully', { contractId, hasData: !!data.value });

    return {
      key: data.key,
      value: data.value,
      durability: data.durability,
    };
  } catch (error) {
    logger.error('Failed to get contract data', { contractId, network, error: error.message });
    throw new Error(`Failed to get contract data: ${error.message}`);
  }
}

/**
 * Get account information
 */
export async function getAccount(accountId, network = 'testnet') {
  try {
    logger.info('Getting account information', { accountId, network });

    const server = getServer(network);
    const account = await server.loadAccount(accountId);
    
    logger.info('Account information retrieved successfully', { accountId });

    return {
      accountId: account.accountId(),
      sequence: account.sequenceNumber(),
      balances: account.balances,
      signers: account.signers,
      thresholds: account.thresholds,
      flags: account.flags,
    };
  } catch (error) {
    logger.error('Failed to get account information', { accountId, network, error: error.message });
    throw new Error(`Failed to get account information: ${error.message}`);
  }
}

/**
 * Get transaction information
 */
export async function getTransaction(transactionHash, network = 'testnet') {
  try {
    logger.info('Getting transaction information', { transactionHash, network });

    const server = getServer(network);
    const transaction = await server.transactionsTransaction(transactionHash);
    
    logger.info('Transaction information retrieved successfully', { transactionHash });

    return {
      hash: transaction.hash,
      ledger: transaction.ledger,
      createdAt: transaction.created_at,
      sourceAccount: transaction.source_account,
      feePaid: transaction.fee_charged,
      operationCount: transaction.operations.length,
      memo: transaction.memo,
      successful: transaction.successful,
      resultXdr: transaction.result_xdr,
    };
  } catch (error) {
    logger.error('Failed to get transaction information', { transactionHash, network, error: error.message });
    throw new Error(`Failed to get transaction information: ${error.message}`);
  }
}

/**
 * Get ledger information
 */
export async function getLedger(ledgerSequence, network = 'testnet') {
  try {
    logger.info('Getting ledger information', { ledgerSequence, network });

    const server = getServer(network);
    const ledger = await server.ledgers().ledger(ledgerSequence);
    
    logger.info('Ledger information retrieved successfully', { ledgerSequence });

    return {
      sequence: ledger.sequence,
      hash: ledger.hash,
      previousHash: ledger.previous_hash,
      timestamp: ledger.closed_at,
      transactionCount: ledger.transaction_count,
      operationCount: ledger.operation_count,
      baseFee: ledger.base_fee,
      baseReserve: ledger.base_reserve,
    };
  } catch (error) {
    logger.error('Failed to get ledger information', { ledgerSequence, network, error: error.message });
    throw new Error(`Failed to get ledger information: ${error.message}`);
  }
}

/**
 * Stream real-time events from a contract
 */
export function streamContractEvents(options) {
  const { 
    contractId, 
    onEvent, 
    onError, 
    onClose, 
    network = 'testnet' 
  } = options;
  
  try {
    logger.info('Starting contract event stream', { contractId, network });

    const server = getServer(network);
    
    const eventSource = server.events()
      .forContract(contractId)
      .stream({
        onmessage: (event) => {
          try {
            const parsedEvent = JSON.parse(event.data);
            logger.debug('Contract event received', { contractId, event: parsedEvent });
            onEvent(parsedEvent);
          } catch (error) {
            logger.error('Failed to parse contract event', { contractId, error: error.message });
            onError(error);
          }
        },
        onerror: (error) => {
          logger.error('Contract event stream error', { contractId, error: error.message });
          onError(error);
        },
        onclose: () => {
          logger.info('Contract event stream closed', { contractId });
          onClose();
        },
      });

    return {
      close: () => {
        eventSource.close();
      },
    };
  } catch (error) {
    logger.error('Failed to start contract event stream', { contractId, network, error: error.message });
    throw new Error(`Failed to start contract event stream: ${error.message}`);
  }
}

/**
 * Get network status
 */
export async function getNetworkStatus(network = 'testnet') {
  try {
    logger.info('Getting network status', { network });

    const server = getServer(network);
    
    // Get latest ledger
    const latestLedger = await server.ledgers().order('desc').limit(1).call();
    
    // Get network stats
    const stats = await server.stats().call();
    
    const status = {
      network,
      latestLedger: latestLedger.records[0]?.sequence || 0,
      latestLedgerHash: latestLedger.records[0]?.hash || '',
      latestLedgerTimestamp: latestLedger.records[0]?.closed_at || '',
      accountsCreated: stats.accounts_created,
      paymentsCount: stats.payments_count,
      transactionsCount: stats.transactions_count,
      online: true,
    };

    logger.info('Network status retrieved successfully', { network, latestLedger: status.latestLedger });

    return status;
  } catch (error) {
    logger.error('Failed to get network status', { network, error: error.message });
    throw new Error(`Failed to get network status: ${error.message}`);
  }
}

/**
 * Validate Stellar address
 */
export function validateAddress(address) {
  try {
    // Use Stellar SDK to validate address
    const keypair = StellarSdk.Keypair.fromPublicKey(address);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Generate a new Stellar keypair
 */
export function generateKeypair() {
  const keypair = StellarSdk.Keypair.random();
  return {
    publicKey: keypair.publicKey(),
    secretKey: keypair.secret(),
  };
}

/**
 * Estimate transaction fee
 */
export function estimateTransactionFee(options) {
  const { 
    operations, 
    network = 'testnet',
    baseFee = BASE_FEE 
  } = options;
  
  try {
    // Estimate fee based on operations and current network conditions
    const estimatedFee = operations.length * baseFee;
    
    // Add buffer for network congestion
    const bufferMultiplier = 1.5;
    const finalFee = Math.ceil(estimatedFee * bufferMultiplier);
    
    logger.info('Transaction fee estimated', { 
      operations: operations.length, 
      baseFee, 
      estimatedFee: finalFee,
      network 
    });

    return {
      baseFee,
      operations: operations.length,
      estimatedFee: finalFee,
      network,
    };
  } catch (error) {
    logger.error('Failed to estimate transaction fee', { network, error: error.message });
    throw new Error(`Failed to estimate transaction fee: ${error.message}`);
  }
}

export default {
  deployContract,
  invokeContract,
  getContractEvents,
  getContractData,
  getAccount,
  getTransaction,
  getLedger,
  streamContractEvents,
  getNetworkStatus,
  validateAddress,
  generateKeypair,
  estimateTransactionFee,
};
