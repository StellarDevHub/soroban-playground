import React from 'react';

interface Subscription {
  user: string;
  plan_id: number;
  start_time: number;
  end_time: number;
  auto_renew: boolean;
  active: boolean;
  payments_made: number;
}

interface SubscriptionStatusProps {
  subscription: Subscription;
  onRenew: () => Promise<void>;
  onCancel: () => Promise<void>;
}

export const SubscriptionStatus: React.FC<SubscriptionStatusProps> = ({
  subscription,
  onRenew,
  onCancel,
}) => {
  const [loading, setLoading] = React.useState(false);

  const daysRemaining = Math.max(
    0,
    Math.floor((subscription.end_time - Date.now() / 1000) / 86400)
  );

  const isExpiringSoon = daysRemaining <= 7;
  const isExpired = daysRemaining === 0;

  const handleRenew = async () => {
    setLoading(true);
    try {
      await onRenew();
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (window.confirm('Are you sure you want to cancel your subscription?')) {
      setLoading(true);
      try {
        await onCancel();
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <section
      className={`bg-white rounded-lg shadow-lg p-6 border-l-4 ${
        isExpired
          ? 'border-red-500'
          : isExpiringSoon
          ? 'border-yellow-500'
          : 'border-green-500'
      }`}
      aria-labelledby="subscription-status-heading"
    >
      <h2 id="subscription-status-heading" className="text-2xl font-bold mb-4">
        Subscription Status
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div>
          <p className="text-sm text-gray-600">Status</p>
          <p className="text-lg font-semibold" aria-live="polite">
            {subscription.active && !isExpired ? (
              <span className="text-green-600">Active</span>
            ) : (
              <span className="text-red-600">Inactive</span>
            )}
          </p>
        </div>

        <div>
          <p className="text-sm text-gray-600">Days Remaining</p>
          <p className="text-lg font-semibold" aria-live="polite">
            {daysRemaining} days
          </p>
        </div>

        <div>
          <p className="text-sm text-gray-600">Auto-Renew</p>
          <p className="text-lg font-semibold">
            {subscription.auto_renew ? (
              <span className="text-green-600">Enabled</span>
            ) : (
              <span className="text-gray-600">Disabled</span>
            )}
          </p>
        </div>
      </div>

      <div className="mb-6">
        <p className="text-sm text-gray-600">Total Payments Made</p>
        <p className="text-lg font-semibold">{subscription.payments_made}</p>
      </div>

      {isExpiringSoon && !isExpired && (
        <div
          className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded mb-4"
          role="alert"
        >
          <p className="font-semibold">Subscription Expiring Soon</p>
          <p className="text-sm">Your subscription will expire in {daysRemaining} days.</p>
        </div>
      )}

      {isExpired && (
        <div
          className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded mb-4"
          role="alert"
        >
          <p className="font-semibold">Subscription Expired</p>
          <p className="text-sm">Please renew your subscription to continue using the service.</p>
        </div>
      )}

      <div className="flex gap-4">
        <button
          onClick={handleRenew}
          disabled={loading}
          className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          aria-busy={loading}
        >
          {loading ? 'Processing...' : 'Renew Now'}
        </button>

        <button
          onClick={handleCancel}
          disabled={loading || !subscription.active}
          className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 disabled:bg-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          aria-busy={loading}
        >
          {loading ? 'Processing...' : 'Cancel Subscription'}
        </button>
      </div>
    </section>
  );
};
