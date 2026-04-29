import React, { useState } from 'react';

interface Plan {
  id: number;
  name: string;
  price: string;
  duration: number;
  features: string[];
  active: boolean;
}

interface PlanCardProps {
  plan: Plan;
  onSubscribe: (planId: number, autoRenew: boolean) => Promise<void>;
}

export const PlanCard: React.FC<PlanCardProps> = ({ plan, onSubscribe }) => {
  const [autoRenew, setAutoRenew] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      await onSubscribe(plan.id, autoRenew);
    } finally {
      setLoading(false);
    }
  };

  const durationDays = Math.floor(plan.duration / 86400);

  return (
    <article className="bg-white rounded-lg shadow-lg p-6 border border-gray-200 hover:shadow-xl transition-shadow">
      <h3 className="text-xl font-bold mb-2" tabIndex={0}>{plan.name}</h3>
      <div className="text-3xl font-bold text-blue-600 mb-4" aria-label={`Price: ${plan.price} per ${durationDays} days`}>
        {plan.price}
        <span className="text-sm text-gray-600 ml-2">/ {durationDays} days</span>
      </div>

      <ul className="space-y-2 mb-6" aria-label="Plan features">
        {plan.features.map((feature, index) => (
          <li key={index} className="flex items-start">
            <svg
              className="w-5 h-5 text-green-500 mr-2 flex-shrink-0 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mb-4">
        <label className="flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={autoRenew}
            onChange={(e) => setAutoRenew(e.target.checked)}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            aria-describedby="auto-renew-description"
          />
          <span className="ml-2 text-sm text-gray-700">Auto-renew subscription</span>
        </label>
        <p id="auto-renew-description" className="sr-only">
          Automatically renew your subscription when it expires
        </p>
      </div>

      <button
        onClick={handleSubscribe}
        disabled={!plan.active || loading}
        className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        aria-busy={loading}
      >
        {loading ? 'Processing...' : 'Subscribe Now'}
      </button>
    </article>
  );
};
