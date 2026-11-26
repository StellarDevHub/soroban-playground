import { Networks, TransactionBuilder } from '@stellar/stellar-sdk';

export const DEFAULT_BASE_FEE = 100;
export const DEFAULT_MAX_FEE = 10_000_000;
export const DEFAULT_STALL_TIMEOUT_MS = 30_000;
export const DEFAULT_POLL_INTERVAL_MS = 5_000;
export const DEFAULT_MAX_BUMPS = 3;
export const DEFAULT_FEE_INCREMENT_MULTIPLIER = 1.5;
export const DEFAULT_FEE_PERCENTILE = 'p90';

const HORIZON_URLS = {
  testnet: 'https://horizon-testnet.stellar.org',
  mainnet: 'https://horizon.stellar.org',
  public: 'https://horizon.stellar.org',
  futurenet: 'https://horizon-futurenet.stellar.org',
};

const NETWORK_PASSPHRASES = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
  public: Networks.PUBLIC,
  futurenet: Networks.FUTURENET,
};

export function getHorizonUrl(network = 'testnet') {
  if (process.env.STELLAR_HORIZON_URL) {
    return process.env.STELLAR_HORIZON_URL.replace(/\/+$/, '');
  }
  const key = String(network || 'testnet').toLowerCase();
  return HORIZON_URLS[key] || HORIZON_URLS.testnet;
}

export function getNetworkPassphrase(network = 'testnet') {
  const key = String(network || 'testnet').toLowerCase();
  return NETWORK_PASSPHRASES[key] || Networks.TESTNET;
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function computeDynamicBaseFee(
  feeStats,
  {
    percentile = DEFAULT_FEE_PERCENTILE,
    fallbackBaseFee = DEFAULT_BASE_FEE,
    minFee = DEFAULT_BASE_FEE,
    maxFee = DEFAULT_MAX_FEE,
    multiplier = 1,
  } = {}
) {
  if (!feeStats || typeof feeStats !== 'object') {
    return Math.min(maxFee, Math.max(minFee, fallbackBaseFee));
  }

  const chargedPercentile = parsePositiveInt(
    feeStats.fee_charged?.[percentile]
  );
  const maxFeePercentile = parsePositiveInt(feeStats.max_fee?.[percentile]);
  const lastLedgerBaseFee = parsePositiveInt(feeStats.last_ledger_base_fee);

  const candidates = [
    chargedPercentile,
    maxFeePercentile,
    lastLedgerBaseFee,
  ].filter((val) => val !== null);

  const base =
    candidates.length > 0 ? Math.max(...candidates) : fallbackBaseFee;
  const scaled = Math.ceil(base * multiplier);

  return Math.min(maxFee, Math.max(minFee, scaled));
}

export async function fetchFeeStats({
  network = 'testnet',
  horizonUrl = getHorizonUrl(network),
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000,
  signal,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch implementation is not available for /fee_stats');
  }

  const url = `${horizonUrl.replace(/\/+$/, '')}/fee_stats`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      throw new Error('Fee stats request aborted');
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Horizon /fee_stats request failed with status ${response.status}`
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

export async function getDynamicBaseFee({
  network = 'testnet',
  horizonUrl = getHorizonUrl(network),
  percentile = DEFAULT_FEE_PERCENTILE,
  fallbackBaseFee = DEFAULT_BASE_FEE,
  minFee = DEFAULT_BASE_FEE,
  maxFee = DEFAULT_MAX_FEE,
  multiplier = 1,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000,
  signal,
} = {}) {
  try {
    const feeStats = await fetchFeeStats({
      network,
      horizonUrl,
      fetchImpl,
      timeoutMs,
      signal,
    });
    const fee = computeDynamicBaseFee(feeStats, {
      percentile,
      fallbackBaseFee,
      minFee,
      maxFee,
      multiplier,
    });
    return { fee, feeStats, source: 'horizon' };
  } catch (error) {
    return {
      fee: Math.min(maxFee, Math.max(minFee, fallbackBaseFee)),
      feeStats: null,
      source: 'fallback',
      error: error.message,
    };
  }
}

export function calculateIncrementedFee(
  currentFee,
  dynamicP90Fee = DEFAULT_BASE_FEE,
  {
    multiplier = DEFAULT_FEE_INCREMENT_MULTIPLIER,
    minIncrement = DEFAULT_BASE_FEE,
    maxFee = DEFAULT_MAX_FEE,
  } = {}
) {
  const safeCurrent = parsePositiveInt(currentFee) || DEFAULT_BASE_FEE;
  const safeDynamic = parsePositiveInt(dynamicP90Fee) || DEFAULT_BASE_FEE;
  const multiplied = Math.ceil(safeCurrent * multiplier);
  const stepped = safeCurrent + minIncrement;

  const nextFee = Math.max(multiplied, stepped, safeDynamic);
  return Math.min(maxFee, nextFee);
}

export function createFeeBumpTransaction({
  innerTransaction,
  innerTransactionXdr,
  feeSource,
  newBaseFee,
  network = 'testnet',
  networkPassphrase = getNetworkPassphrase(network),
  feeSourceKeypair,
  feeBumpSigner,
} = {}) {
  if (!feeSource) {
    throw new Error('feeSource is required to build a fee-bump transaction');
  }

  let resolvedInner = innerTransaction;
  if (!resolvedInner && innerTransactionXdr) {
    resolvedInner = TransactionBuilder.fromXDR(
      innerTransactionXdr,
      networkPassphrase
    );
  }
  if (!resolvedInner) {
    throw new Error(
      'innerTransaction or innerTransactionXdr is required to build a fee-bump transaction'
    );
  }

  const innerFee = parsePositiveInt(resolvedInner.fee) || DEFAULT_BASE_FEE;
  const requestedFee = parsePositiveInt(newBaseFee) || innerFee + DEFAULT_BASE_FEE;
  const effectiveFee = Math.max(requestedFee, innerFee + 1);

  const feeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
    feeSource,
    String(effectiveFee),
    resolvedInner,
    networkPassphrase
  );

  if (feeSourceKeypair) {
    feeBumpTransaction.sign(feeSourceKeypair);
  } else if (typeof feeBumpSigner === 'function') {
    feeBumpSigner(feeBumpTransaction);
  }

  return {
    feeBumpTransaction,
    xdr: feeBumpTransaction.toXDR(),
    fee: effectiveFee,
    hash: feeBumpTransaction.hash().toString('hex'),
    innerHash: resolvedInner.hash().toString('hex'),
  };
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Fee-bump operation aborted'));
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Fee-bump operation aborted'));
    };

    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function defaultSubmitTransaction(
  txOrXdr,
  { horizonUrl, fetchImpl = globalThis.fetch, signal }
) {
  const xdr = typeof txOrXdr === 'string' ? txOrXdr : txOrXdr.toXDR();
  const response = await fetchImpl(
    `${horizonUrl.replace(/\/+$/, '')}/transactions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ tx: xdr }).toString(),
      signal,
    }
  );

  const payload = await response.json();
  if (!response.ok) {
    const err = new Error(
      payload?.title || `Horizon transaction submission failed (${response.status})`
    );
    err.status = response.status;
    err.response = payload;
    throw err;
  }

  return payload;
}

async function defaultCheckTransactionStatus(
  hash,
  { horizonUrl, fetchImpl = globalThis.fetch, signal }
) {
  const response = await fetchImpl(
    `${horizonUrl.replace(/\/+$/, '')}/transactions/${encodeURIComponent(hash)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    }
  );

  if (response.status === 404) {
    return { status: 'pending' };
  }

  if (!response.ok) {
    throw new Error(
      `Horizon transaction status check failed with status ${response.status}`
    );
  }

  const payload = await response.json();
  if (payload.successful === true) {
    return { status: 'confirmed', result: payload };
  }
  if (payload.successful === false) {
    return { status: 'failed', result: payload };
  }
  return { status: 'pending', result: payload };
}

export async function submitWithAutoFeeBump({
  innerTransaction,
  innerTransactionXdr,
  feeSource,
  feeSourceKeypair,
  feeBumpSigner,
  network = 'testnet',
  horizonUrl = getHorizonUrl(network),
  networkPassphrase = getNetworkPassphrase(network),
  submitTransaction,
  checkTransactionStatus,
  stallTimeoutMs = Number.parseInt(
    process.env.FEE_BUMP_STALL_TIMEOUT_MS || `${DEFAULT_STALL_TIMEOUT_MS}`,
    10
  ),
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxBumps = DEFAULT_MAX_BUMPS,
  feeIncrementMultiplier = DEFAULT_FEE_INCREMENT_MULTIPLIER,
  percentile = DEFAULT_FEE_PERCENTILE,
  maxFee = DEFAULT_MAX_FEE,
  fetchImpl = globalThis.fetch,
  onFeeBump,
  signal,
} = {}) {
  const resolvedInner =
    innerTransaction ||
    (innerTransactionXdr
      ? TransactionBuilder.fromXDR(innerTransactionXdr, networkPassphrase)
      : null);

  if (!resolvedInner) {
    throw new Error(
      'innerTransaction or innerTransactionXdr is required for submitWithAutoFeeBump'
    );
  }

  const submitFn =
    submitTransaction ||
    ((tx) => defaultSubmitTransaction(tx, { horizonUrl, fetchImpl, signal }));
  const statusFn =
    checkTransactionStatus ||
    ((hash) =>
      defaultCheckTransactionStatus(hash, { horizonUrl, fetchImpl, signal }));

  const initialDynamic = await getDynamicBaseFee({
    network,
    horizonUrl,
    percentile,
    maxFee,
    fetchImpl,
    signal,
  });

  let currentFee = Math.max(
    parsePositiveInt(resolvedInner.fee) || DEFAULT_BASE_FEE,
    initialDynamic.fee
  );
  let activeTx = resolvedInner;
  let activeHash = resolvedInner.hash().toString('hex');
  const bumpHistory = [];

  const initialSubmit = await submitFn(activeTx, {
    attempt: 0,
    fee: currentFee,
    isFeeBump: false,
  });

  if (initialSubmit?.hash) {
    activeHash = initialSubmit.hash;
  }

  if (
    initialSubmit?.status === 'confirmed' ||
    initialSubmit?.successful === true
  ) {
    return {
      status: 'confirmed',
      hash: activeHash,
      fee: currentFee,
      bumps: 0,
      bumpHistory,
      result: initialSubmit,
    };
  }

  for (let bumpAttempt = 0; bumpAttempt <= maxBumps; bumpAttempt += 1) {
    const attemptStart = Date.now();

    while (Date.now() - attemptStart < stallTimeoutMs) {
      if (signal?.aborted) {
        throw new Error('Fee-bump operation aborted');
      }

      const statusCheck = await statusFn(activeHash, {
        attempt: bumpAttempt,
        fee: currentFee,
      });

      if (
        statusCheck?.status === 'confirmed' ||
        statusCheck?.successful === true
      ) {
        return {
          status: 'confirmed',
          hash: activeHash,
          fee: currentFee,
          bumps: bumpAttempt,
          bumpHistory,
          result: statusCheck.result ?? statusCheck,
        };
      }

      if (
        statusCheck?.status === 'failed' ||
        statusCheck?.successful === false
      ) {
        const error = new Error(
          statusCheck?.error ||
            `Transaction ${activeHash} failed on Stellar network`
        );
        error.hash = activeHash;
        error.result = statusCheck.result ?? statusCheck;
        throw error;
      }

      const remainingMs = stallTimeoutMs - (Date.now() - attemptStart);
      if (remainingMs <= 0) {
        break;
      }
      await sleep(Math.min(pollIntervalMs, remainingMs), signal);
    }

    if (bumpAttempt >= maxBumps) {
      const error = new Error(
        `Transaction ${activeHash} remained stalled after ${maxBumps} fee-bump attempts`
      );
      error.code = 'TX_STALLED_MAX_BUMPS';
      error.hash = activeHash;
      error.bumps = maxBumps;
      error.bumpHistory = bumpHistory;
      throw error;
    }

    const latestDynamic = await getDynamicBaseFee({
      network,
      horizonUrl,
      percentile,
      maxFee,
      fetchImpl,
      signal,
    });

    const previousFee = currentFee;
    const nextFee = calculateIncrementedFee(currentFee, latestDynamic.fee, {
      multiplier: feeIncrementMultiplier,
      maxFee,
    });

    const bumped = createFeeBumpTransaction({
      innerTransaction: resolvedInner,
      feeSource: feeSource || resolvedInner.source,
      newBaseFee: nextFee,
      network,
      networkPassphrase,
      feeSourceKeypair,
      feeBumpSigner,
    });

    currentFee = bumped.fee;
    activeTx = bumped.feeBumpTransaction;
    activeHash = bumped.hash;

    const bumpRecord = {
      attempt: bumpAttempt + 1,
      previousFee,
      newFee: currentFee,
      dynamicP90Fee: latestDynamic.fee,
      hash: activeHash,
      innerHash: bumped.innerHash,
      timestamp: new Date().toISOString(),
    };
    bumpHistory.push(bumpRecord);
    onFeeBump?.(bumpRecord);

    const resubmitResult = await submitFn(activeTx, {
      attempt: bumpAttempt + 1,
      fee: currentFee,
      isFeeBump: true,
      feeBumpXdr: bumped.xdr,
    });

    if (resubmitResult?.hash) {
      activeHash = resubmitResult.hash;
    }

    if (
      resubmitResult?.status === 'confirmed' ||
      resubmitResult?.successful === true
    ) {
      return {
        status: 'confirmed',
        hash: activeHash,
        fee: currentFee,
        bumps: bumpAttempt + 1,
        bumpHistory,
        result: resubmitResult,
      };
    }
  }

  throw new Error('Unexpected exit from fee-bump loop');
}
