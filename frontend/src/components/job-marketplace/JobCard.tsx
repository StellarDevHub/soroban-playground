// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

'use client';

import React, { useState, useEffect } from 'react';
import jobMarketplaceApi from '@/services/jobMarketplaceApi';

interface JobCardProps {
  job: any;
  onAccept?: (jobId: number) => void;
  onCancel?: (jobId: number) => void;
  onViewDetails?: (jobId: number) => void;
}

const JobCard: React.FC<JobCardProps> = ({ job, onAccept, onCancel, onViewDetails }) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Open':
        return 'bg-green-100 text-green-800';
      case 'InProgress':
        return 'bg-blue-100 text-blue-800';
      case 'Completed':
        return 'bg-purple-100 text-purple-800';
      case 'Disputed':
        return 'bg-red-100 text-red-800';
      case 'Cancelled':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatEscrow = (escrow: string) => {
    const value = BigInt(escrow) / BigInt(10000000);
    return `${value} tokens`;
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            {job.title}
          </h3>
          <p className="text-gray-600 text-sm line-clamp-2">
            {job.description}
          </p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(job.status)}`}>
          {job.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-sm text-gray-500">Escrow Amount</p>
          <p className="text-lg font-semibold text-gray-900">
            {formatEscrow(job.total_escrow)}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Milestones</p>
          <p className="text-lg font-semibold text-gray-900">
            {job.milestones?.length || 0}
          </p>
        </div>
      </div>

      {job.required_skills && job.required_skills.length > 0 && (
        <div className="mb-4">
          <p className="text-sm text-gray-500 mb-2">Required Skills</p>
          <div className="flex flex-wrap gap-2">
            {job.required_skills.map((skill: string, index: number) => (
              <span
                key={index}
                className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-between items-center pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          Created: {new Date(job.created_at).toLocaleDateString()}
        </p>
        <div className="flex gap-2">
          {onViewDetails && (
            <button
              onClick={() => onViewDetails(job.id)}
              className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
            >
              View Details
            </button>
          )}
          {job.status === 'Open' && onAccept && (
            <button
              onClick={() => onAccept(job.id)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              Accept Job
            </button>
          )}
          {job.status === 'Open' && onCancel && (
            <button
              onClick={() => onCancel(job.id)}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default JobCard;
