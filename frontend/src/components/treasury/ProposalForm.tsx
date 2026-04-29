"use client";

import React, { useState } from 'react';
import { Send } from 'lucide-react';

export function ProposalForm() {
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    // Mock submission
    setTimeout(() => {
      setIsSubmitting(false);
      setAmount('');
      setRecipient('');
      setDescription('');
    }, 1500);
  };

  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
      
      <h3 className="text-2xl font-semibold text-white mb-6">Create Proposal</h3>
      
      <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">Amount (XLM)</label>
          <div className="relative">
            <input 
              type="number"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              placeholder="0.00"
            />
            <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-gray-500 font-medium">
              XLM
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">Recipient Address</label>
          <input 
            type="text"
            required
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            placeholder="G..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">Description</label>
          <textarea 
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all h-24 resize-none"
            placeholder="Why is this proposal needed?"
          />
        </div>

        <button 
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold py-4 rounded-xl shadow-lg hover:shadow-blue-500/25 transition-all flex items-center justify-center gap-2 group disabled:opacity-50"
        >
          {isSubmitting ? 'Submitting...' : 'Submit Proposal'}
          {!isSubmitting && <Send size={18} className="group-hover:translate-x-1 transition-transform" />}
        </button>
      </form>
    </div>
  );
}
