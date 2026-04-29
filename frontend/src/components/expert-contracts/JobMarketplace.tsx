import React, { useState } from 'react';

export default function JobMarketplace() {
    const [jobs, setJobs] = useState([]);

    return (
        <div className="p-4 border rounded shadow">
            <h2 className="text-xl font-bold mb-4">Decentralized Job Marketplace</h2>
            <div className="mb-4">
                <button className="bg-purple-500 text-white px-4 py-2 rounded mr-2">
                    Post Job
                </button>
            </div>
            <div>
                <h3 className="font-semibold mb-2">Open Jobs</h3>
                {jobs.length === 0 ? (
                    <p className="text-gray-500">No open jobs currently available.</p>
                ) : (
                    <ul>
                        {jobs.map((j: any, i) => (
                            <li key={i}>Job #{j.id}</li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
