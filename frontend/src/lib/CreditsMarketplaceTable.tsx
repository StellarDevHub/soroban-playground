'use client';
import React from 'react';
import { CarbonCredit } from '@/types/carbonCredits';

interface Props {
  credits: CarbonCredit[];
  onVerifyClick: (id: string) => void;
}

export default function CreditsMarketplaceTable({ credits, onVerifyClick }: Props) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-gray-500 font-medium uppercase tracking-wider">
          <tr>
            <th className="px-6 py-4">ID</th>
            <th className="px-6 py-4">Project</th>
            <th className="px-6 py-4 text-right">Offset (kg)</th>
            <th className="px-6 py-4">Status</th>
            <th className="px-6 py-4 text-center">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {credits.map((credit) => (
            <tr key={credit.id} className="hover:bg-gray-50 transition">
              <td className="px-6 py-4 font-mono text-xs text-indigo-600">#{credit.id}</td>
              <td className="px-6 py-4">
                <div className="font-medium">{credit.project_type}</div>
                <div className="text-xs text-gray-400">{credit.project_id}</div>
              </td>
              <td className="px-6 py-4 text-right font-semibold">
                {credit.co2_offset.toLocaleString()}
              </td>
              <td className="px-6 py-4">
                <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                  credit.verified ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {credit.verified ? 'Verified' : 'Pending'}
                </span>
              </td>
              <td className="px-6 py-4 text-center">
                {!credit.verified && (
                  <button 
                    onClick={() => onVerifyClick(credit.id)}
                    className="text-xs font-bold text-indigo-600 hover:underline"
                  >
                    Verify Now
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}