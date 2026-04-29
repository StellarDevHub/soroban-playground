import { RealEstateDashboard } from '@/components/RealEstateDashboard';

export const metadata = {
  title: 'Real Estate Tokenization | Soroban Playground',
  description: 'Fractional ownership and rental distribution on Stellar Soroban.',
};

export default function RealEstatePage() {
  return (
    <main>
      <RealEstateDashboard />
    </main>
  );
}
