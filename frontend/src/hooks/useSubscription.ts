import { useState, useCallback } from 'react';
import { subscriptionApi } from '../services/subscriptionApi';

export const useSubscription = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subscribe = useCallback(async (planId: number, autoRenew: boolean) => {
    setLoading(true);
    setError(null);
    try {
      await subscriptionApi.subscribe(planId, autoRenew);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to subscribe';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const renewSubscription = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await subscriptionApi.renewSubscription();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to renew';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const cancelSubscription = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await subscriptionApi.cancelSubscription();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPlans = useCallback(async () => {
    return await subscriptionApi.getPlans();
  }, []);

  const fetchSubscription = useCallback(async () => {
    return await subscriptionApi.getSubscription();
  }, []);

  const fetchUsage = useCallback(async () => {
    return await subscriptionApi.getUsage();
  }, []);

  return {
    loading,
    error,
    subscribe,
    renewSubscription,
    cancelSubscription,
    fetchPlans,
    fetchSubscription,
    fetchUsage,
  };
};
