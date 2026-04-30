import type { Metadata } from 'next';
import PatentRegistryDashboard from '../../components/PatentRegistryDashboard';

export const metadata: Metadata = {
  title: 'Patent Registry | Soroban Playground',
  description: 'File, license, transfer, and dispute patents on the Stellar Soroban testnet.',
};

export default function PatentRegistryPage() {
  return <PatentRegistryDashboard />;
}
