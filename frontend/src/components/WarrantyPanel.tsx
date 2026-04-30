import React, { useState } from 'react';

export default function WarrantyPanel() {
  const [productId, setProductId] = useState('');
  const [status, setStatus] = useState('');

  const handleRegister = async () => {
    setStatus('Registering on-chain...');
    // Simulated logic for the walkthrough
    setTimeout(() => {
      setStatus('Success! Warranty #1 created.');
    }, 1500);
  };

  return (
    <div className="p-6 bg-gray-900 text-white rounded-lg border border-gray-800">
      <h2 className="text-xl font-bold mb-4 text-cyan-400">Decentralized Warranty Management</h2>
      <div className="space-y-4">
        <input 
          type="number" 
          placeholder="Product ID" 
          className="w-full p-2 bg-black border border-gray-700 rounded"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
        />
        <button 
          onClick={handleRegister}
          className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 rounded font-bold transition"
        >
          Register Product
        </button>
        {status && <p className="text-sm text-gray-400 mt-2 italic">{status}</p>}
      </div>
    </div>
  );
}
