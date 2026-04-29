// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

'use client';

import React, { useState, useEffect } from 'react';
import JobCard from '@/components/job-marketplace/JobCard';
import CreateJobForm from '@/components/job-marketplace/CreateJobForm';
import jobMarketplaceApi from '@/services/jobMarketplaceApi';

export default function JobsPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [filters, setFilters] = useState({
    status: '',
    page: 1,
    limit: 20,
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJobs();
  }, [filters]);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await jobMarketplaceApi.getJobs(filters);
      setJobs(response.data.jobs);
      setPagination(response.data.pagination);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch jobs');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateJob = async (jobData: any) => {
    try {
      setError(null);
      // In a real implementation, you would need to get the client address from wallet
      const jobDataWithClient = {
        ...jobData,
        client: 'CLIENT_ADDRESS_FROM_WALLET', // Replace with actual wallet integration
      };
      
      await jobMarketplaceApi.createJob(jobDataWithClient);
      setShowCreateForm(false);
      fetchJobs();
    } catch (err: any) {
      setError(err.message || 'Failed to create job');
    }
  };

  const handleAcceptJob = async (jobId: number) => {
    try {
      setError(null);
      // Replace with actual freelancer address from wallet
      const freelancerAddress = 'FREELANCER_ADDRESS_FROM_WALLET';
      await jobMarketplaceApi.acceptJob(jobId, freelancerAddress);
      fetchJobs();
    } catch (err: any) {
      setError(err.message || 'Failed to accept job');
    }
  };

  const handleCancelJob = async (jobId: number) => {
    try {
      setError(null);
      // Replace with actual client address from wallet
      const clientAddress = 'CLIENT_ADDRESS_FROM_WALLET';
      await jobMarketplaceApi.cancelJob(jobId, clientAddress);
      fetchJobs();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel job');
    }
  };

  const handleViewDetails = (jobId: number) => {
    // Navigate to job details page
    window.location.href = `/job-marketplace/jobs/${jobId}`;
  };

  if (showCreateForm) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <CreateJobForm
          onSubmit={handleCreateJob}
          onCancel={() => setShowCreateForm(false)}
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Job Marketplace</h1>
          <p className="text-gray-600 mt-2">Find opportunities or hire talented developers</p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-md"
        >
          + Create New Job
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex gap-4 items-center">
          <label className="text-sm font-medium text-gray-700">Filter by Status:</label>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">All Jobs</option>
            <option value="Open">Open</option>
            <option value="InProgress">In Progress</option>
            <option value="Completed">Completed</option>
            <option value="Disputed">Disputed</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Loading jobs...</p>
        </div>
      ) : (
        <>
          {/* Jobs Grid */}
          {jobs.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onAccept={handleAcceptJob}
                  onCancel={handleCancelJob}
                  onViewDetails={handleViewDetails}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-white rounded-lg shadow-md">
              <p className="text-gray-600 text-lg">No jobs found</p>
              <button
                onClick={() => setShowCreateForm(true)}
                className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Create the first job
              </button>
            </div>
          )}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex justify-center items-center gap-4 mt-8">
              <button
                onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
                disabled={filters.page === 1}
                className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-gray-700">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
                disabled={filters.page === pagination.totalPages}
                className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
