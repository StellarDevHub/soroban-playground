const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

export async function fetchImpactMetrics() {
  const res = await fetch(`${BASE_URL}/impact/dashboard`);
  if (!res.ok) throw new Error('Failed to fetch metrics');
  return res.json();
}

export async function fetchCreditDetails(id: string) {
  const res = await fetch(`${BASE_URL}/credits/${id}`);
  if (!res.ok) throw new Error('Credit not found');
  return res.json();
}

export async function mintCredits(data: any) {
  const res = await fetch(`${BASE_URL}/credits/mint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function verifyCredit(id: string) {
  const res = await fetch(`${BASE_URL}/credits/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  return res.json();
}

export async function fetchTransactionHistory() {
  const res = await fetch(`${BASE_URL}/transactions`);
  if (!res.ok) throw new Error('Failed to fetch history');
  return res.json();
}