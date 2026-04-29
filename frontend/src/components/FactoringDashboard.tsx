import React, { useState } from 'react';

export default function FactoringDashboard() {
  const [amount, setAmount] = useState('');
  const [risk, setRisk] = useState<number | null>(null);
  const [status, setStatus] = useState('');

  const assessRisk = async () => {
    setStatus('Analyzing risk profile...');
    // Simulating backend call
    const score = parseInt(amount) > 5000 ? 8 : 3;
    setTimeout(() => {
      setRisk(score);
      setStatus('Risk assessment complete.');
    }, 1000);
  };

  const submitInvoice = () => {
    setStatus('Transacting on Soroban...');
    setTimeout(() => {
      setStatus(`Success! Invoice listed with ${200 + (risk! * 10)} bps discount.`);
    }, 1500);
  };

  return (
    <div className="p-6 bg-gray-900 text-white rounded-lg border border-indigo-500/50 shadow-xl">
      <h2 className="text-xl font-bold mb-4 text-indigo-400">Invoice Factoring Hub</h2>
      <div className="space-y-4">
        <input 
          type="number" 
          placeholder="Invoice Amount (USD)" 
          className="w-full p-2 bg-black border border-gray-700 rounded focus:border-indigo-500 outline-none"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {!risk ? (
          <button onClick={assessRisk} className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-bold transition">
            Assess Risk
          </button>
        ) : (
          <div className="space-y-4">
            <div className="p-3 bg-gray-800 rounded border border-gray-700">
              <p className="text-sm">Risk Score: <span className="text-indigo-400 font-mono">{risk}/10</span></p>
              <p className="text-sm">Est. Discount: <span className="text-indigo-400 font-mono">{(200 + (risk * 10)) / 100}%</span></p>
            </div>
            <button onClick={submitInvoice} className="w-full py-2 bg-green-600 hover:bg-green-500 rounded font-bold transition">
              Liquidate Invoice
            </button>
          </div>
        )}
        {status && <p className="text-xs text-gray-400 italic text-center">{status}</p>}
      </div>
    </div>
  );
}
