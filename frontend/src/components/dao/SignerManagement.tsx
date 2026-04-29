import React, { useState, useEffect } from 'react';
import { useTreasury } from '../../hooks/useTreasury';

interface SignerManagementProps {
  onUpdate: () => void;
}

export const SignerManagement: React.FC<SignerManagementProps> = ({ onUpdate }) => {
  const [signers, setSigners] = useState<string[]>([]);
  const [threshold, setThreshold] = useState(0);
  const [newSigner, setNewSigner] = useState('');
  const [newThreshold, setNewThreshold] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { getSigners, getThreshold, addSigner, removeSigner, updateThreshold } = useTreasury();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [signersData, thresholdData] = await Promise.all([
        getSigners(),
        getThreshold(),
      ]);
      setSigners(signersData);
      setThreshold(thresholdData);
    } catch (err) {
      setError('Failed to load signer data');
    }
  };

  const handleAddSigner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSigner) return;

    setLoading(true);
    setError(null);
    try {
      await addSigner(newSigner);
      setNewSigner('');
      await loadData();
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add signer');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveSigner = async (signer: string) => {
    if (!confirm(`Remove signer ${signer}?`)) return;

    setLoading(true);
    setError(null);
    try {
      await removeSigner(signer);
      await loadData();
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove signer');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateThreshold = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = parseInt(newThreshold);
    if (isNaN(value) || value <= 0 || value > signers.length) {
      setError('Invalid threshold value');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await updateThreshold(value);
      setNewThreshold('');
      await loadData();
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update threshold');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded" role="alert">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-semibold mb-4">Current Configuration</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-600">Total Signers</p>
            <p className="text-2xl font-bold">{signers.length}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Required Signatures</p>
            <p className="text-2xl font-bold">{threshold}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-xl font-semibold mb-4">Signers</h3>
        <ul className="space-y-2">
          {signers.map((signer, index) => (
            <li key={index} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="font-mono text-sm truncate flex-1">{signer}</span>
              <button
                onClick={() => handleRemoveSigner(signer)}
                disabled={loading || signers.length <= threshold}
                className="ml-4 text-red-600 hover:text-red-800 disabled:text-gray-400 disabled:cursor-not-allowed"
                aria-label={`Remove signer ${signer}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={handleAddSigner} className="mt-4">
          <label htmlFor="newSigner" className="block text-sm font-medium text-gray-700 mb-2">
            Add New Signer
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              id="newSigner"
              value={newSigner}
              onChange={(e) => setNewSigner(e.target.value)}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="G..."
            />
            <button
              type="submit"
              disabled={loading || !newSigner}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
            >
              Add
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-xl font-semibold mb-4">Update Threshold</h3>
        <form onSubmit={handleUpdateThreshold} className="flex gap-2">
          <input
            type="number"
            value={newThreshold}
            onChange={(e) => setNewThreshold(e.target.value)}
            min="1"
            max={signers.length}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            placeholder={`1 - ${signers.length}`}
          />
          <button
            type="submit"
            disabled={loading || !newThreshold}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
          >
            Update
          </button>
        </form>
      </div>
    </div>
  );
};
