import { TicketingDashboard } from '@/components/TicketingDashboard';

export const metadata = {
  title: 'Ticketing Dashboard | Soroban Playground',
  description: 'Manage your decentralized events and tickets with anti-scalp protection.',
};

export default function TicketingPage() {
  return (
    <main>
      <TicketingDashboard />
    </main>
  );
}
