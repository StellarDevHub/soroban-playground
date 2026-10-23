// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { useState, useCallback, useMemo } from "react";
import { Keypair } from "@stellar/stellar-sdk";
import {
  feeBumpService,
  FeeBumpService,
  FeeBreakdown,
  RelayerBudgetExhaustedError,
} from "../services/stellar/feeBumpService";

export interface UseFeeBumpOptions {
  initialSponsored?: boolean;
  networkPassphrase?: string;
  sponsorKeypair?: Keypair | string;
  maxBaseFee?: number | string;
  autoFallback?: boolean;
  onFallbackToSelfPay?: (reason: string) => void;
  service?: FeeBumpService;
}

export interface UseFeeBumpReturn {
  isSponsored: boolean;
  setIsSponsored: (enabled: boolean) => void;
  toggleSponsorship: () => void;
  sponsorAddress: string;
  isBudgetExhausted: boolean;
  budgetRemainingStroops: string;
  budgetRemainingXlm: string;
  fallbackOccurred: boolean;
  fallbackReason: string | null;
  error: string | null;
  clearError: () => void;
  resetFallback: () => void;
  getFeeBreakdown: (xdr: string) => FeeBreakdown;
  wrapTransaction: (signedInnerXdr: string) => Promise<string>;
  submitTransaction: <T>(
    signedInnerXdr: string,
    submitFn: (xdr: string) => Promise<T>
  ) => Promise<T>;
  refreshBudget: () => void;
}

export function useFeeBump(options: UseFeeBumpOptions = {}): UseFeeBumpReturn {
  const service = options.service ?? feeBumpService;
  const autoFallback = options.autoFallback ?? true;

  const [isSponsored, setIsSponsoredState] = useState<boolean>(
    options.initialSponsored ?? true
  );
  const [fallbackOccurred, setFallbackOccurred] = useState<boolean>(false);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setBudgetVersion] = useState<number>(0);

  const refreshBudget = useCallback(() => {
    setBudgetVersion((v) => v + 1);
  }, []);

  const sponsorAddress = useMemo(() => {
    return service.getSponsorAddress();
  }, [service]);

  const isBudgetExhausted = useMemo(() => {
    return service.isBudgetExhausted();
  }, [service]);

  const budgetRemainingStroops = useMemo(() => {
    return service.getRemainingBudget().toString();
  }, [service]);

  const budgetRemainingXlm = useMemo(() => {
    const stroops = Number(service.getRemainingBudget());
    return `${(stroops / 10_000_000).toFixed(7)} XLM`;
  }, [service]);

  const setIsSponsored = useCallback(
    (enabled: boolean) => {
      if (enabled && service.isBudgetExhausted()) {
        const reason = "Cannot enable sponsorship: Relayer sponsor budget is exhausted.";
        setFallbackOccurred(true);
        setFallbackReason(reason);
        setIsSponsoredState(false);
        options.onFallbackToSelfPay?.(reason);
        return;
      }
      setIsSponsoredState(enabled);
      if (enabled) {
        setFallbackOccurred(false);
        setFallbackReason(null);
      }
    },
    [service, options]
  );

  const toggleSponsorship = useCallback(() => {
    setIsSponsored(!isSponsored);
  }, [isSponsored, setIsSponsored]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const resetFallback = useCallback(() => {
    setFallbackOccurred(false);
    setFallbackReason(null);
  }, []);

  const getFeeBreakdown = useCallback(
    (xdr: string): FeeBreakdown => {
      return service.calculateFeeBreakdown(
        xdr,
        isSponsored,
        options.networkPassphrase
      );
    },
    [service, isSponsored, options.networkPassphrase]
  );

  const wrapTransaction = useCallback(
    async (signedInnerXdr: string): Promise<string> => {
      setError(null);

      if (!isSponsored) {
        return signedInnerXdr;
      }

      // Check if relayer budget is exhausted
      if (service.isBudgetExhausted()) {
        const reason = "Relayer sponsor budget is exhausted. Falling back to self-pay.";
        if (autoFallback) {
          setFallbackOccurred(true);
          setFallbackReason(reason);
          setIsSponsoredState(false);
          options.onFallbackToSelfPay?.(reason);
          return signedInnerXdr;
        } else {
          const err = new RelayerBudgetExhaustedError(reason);
          setError(err.message);
          throw err;
        }
      }

      try {
        const result = service.wrapWithFeeBump({
          innerTxXdr: signedInnerXdr,
          sponsorKeypair: options.sponsorKeypair,
          maxBaseFee: options.maxBaseFee,
          networkPassphrase: options.networkPassphrase,
        });
        refreshBudget();
        return result.feeBumpXdr;
      } catch (err: unknown) {
        if (err instanceof RelayerBudgetExhaustedError && autoFallback) {
          const reason = err.message || "Relayer sponsor budget is exhausted. Falling back to self-pay.";
          setFallbackOccurred(true);
          setFallbackReason(reason);
          setIsSponsoredState(false);
          options.onFallbackToSelfPay?.(reason);
          return signedInnerXdr;
        }

        const msg = err instanceof Error ? err.message : "Failed to wrap sponsored transaction";
        setError(msg);
        throw err;
      }
    },
    [isSponsored, service, autoFallback, options, refreshBudget]
  );

  const submitTransaction = useCallback(
    async <T>(
      signedInnerXdr: string,
      submitFn: (xdr: string) => Promise<T>
    ): Promise<T> => {
      const finalXdr = await wrapTransaction(signedInnerXdr);
      return await submitFn(finalXdr);
    },
    [wrapTransaction]
  );

  return {
    isSponsored,
    setIsSponsored,
    toggleSponsorship,
    sponsorAddress,
    isBudgetExhausted,
    budgetRemainingStroops,
    budgetRemainingXlm,
    fallbackOccurred,
    fallbackReason,
    error,
    clearError,
    resetFallback,
    getFeeBreakdown,
    wrapTransaction,
    submitTransaction,
    refreshBudget,
  };
}
