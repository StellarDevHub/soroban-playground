import TokenBurnDashboard from '@/components/TokenBurnDashboard';

export const metadata = {
  title: 'Token Burn | Soroban Playground',
  description: 'Burn tokens and track deflationary supply on Stellar Soroban.',
};

export default function TokenBurnPage() {
  return (
    <main className="min-h-screen bg-slate-100 dark:bg-slate-950 p-6">
      <div className="max-w-4xl mx-auto">
        <TokenBurnDashboard />
      </div>
    </main>
  );
}
