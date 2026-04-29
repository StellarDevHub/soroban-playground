import React, { useState, useEffect } from 'react';
import { useSubscription } from '../../hooks/useSubscription';
import { PlanCard } from './PlanCard';
import { UsageChart } from './UsageChart';
import { SubscriptionStatus } from './SubscriptionStatus';
import { PaymentHistory } from './PaymentHistory';

interface Plan {
  id: number;
  name: string;
  price: string;
  duration: number;
  features: string[];
  active: boolean;
}

interface Subscription {
  user: string;
  plan_id: number;
  start_time: number;
  end_time: number;
  auto_renew: boolean;
  active: boolean;
  payments_made: number;
}

interface UsageMetrics {
  api_calls: number;
  storage_used: number;
  bandwidth: number;
  last_updated: number;
}

export const SubscriptionDashboard: React.FC = () => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<UsageMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { subscribe, renewSubscription, cancelSubscription, fetchPlans, fetchSubscription, fetchUsage } = useSubscription();

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [plansData, subData, usageData] = await Promise.all([
        fetchPlans(),
        fetchSubscription(),
        fetchUsage(),
      ]);
      setPlans(plansData);
      setSubscription(subData);
      setUsage(usageData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async (planId: number, autoRenew: boolean) => {
    try {
      await subscribe(planId, autoRenew);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to subscribe');
    }
  };

  const handleRenew = async () => {
    try {
      await renewSubscription();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to renew');
    }
  };

  const handleCancel = async () => {
    try {
      await cancelSubscription();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" role="status" aria-live="polite">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" aria-hidden="true"></div>
        <span className="sr-only">Loading subscription data...</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8" tabIndex={0}>Subscription Management</h1>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6" role="alert">
          <strong className="font-bold">Error: </strong>
          <span>{error}</span>
        </div>
      )}

      {subscription && (
        <div className="mb-8">
          <SubscriptionStatus
            subscription={subscription}
            onRenew={handleRenew}
            onCancel={handleCancel}
          />
        </div>
      )}

      {!subscription && (
        <section aria-labelledby="plans-heading">
          <h2 id="plans-heading" className="text-2xl font-semibold mb-6">Available Plans</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                onSubscribe={handleSubscribe}
              />
            ))}
          </div>
        </section>
      )}

      {subscription && usage && (
        <section aria-labelledby="usage-heading">
          <h2 id="usage-heading" className="text-2xl font-semibold mb-6">Usage Analytics</h2>
          <UsageChart usage={usage} />
        </section>
      )}

      {subscription && (
        <section aria-labelledby="payment-heading" className="mt-8">
          <h2 id="payment-heading" className="text-2xl font-semibold mb-6">Payment History</h2>
          <PaymentHistory subscription={subscription} />
        </section>
      )}
    </div>
  );
};
