'use client';
import React, { useState } from 'react';
import { verifyCredit } from '@/lib/api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  creditId?: string;
}

export default function VerifyCredentialModal({ isOpen, onClose, creditId }: Props) {
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleVerify = async () => {
    if (!creditId) return;
    setLoading(true);
    try {
      await verifyCredit(creditId);
      alert('Credit verified successfully');
      onClose();
    } catch (e) {
      alert('Verification failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white p-6 rounded-xl shadow-2xl">
        <h2 className="text-xl font-bold mb-4">Verify Carbon Credit</h2>
        <p className="text-gray-600 mb-6">
          Are you sure you want to verify credit <strong>#{creditId}</strong>? 
          This will finalize the environmental impact validation.
        </p>
        <div className="flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg transition"
          >
            Cancel
          </button>
          <button 
            onClick={handleVerify}
            disabled={loading}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
          >
            {loading ? 'Processing...' : 'Confirm Verification'}
          </button>
        </div>
      </div>
    </div>
  );
}