import React, { useState } from 'react';

export default function QuadraticVoting() {
    const [proposals, setProposals] = useState([]);

    return (
        <div className="p-4 border rounded shadow">
            <h2 className="text-xl font-bold mb-4">Quadratic Voting Dashboard</h2>
            <div className="mb-4">
                <button className="bg-green-500 text-white px-4 py-2 rounded mr-2">
                    Create Proposal
                </button>
                <button className="bg-gray-500 text-white px-4 py-2 rounded">
                    Whitelist User
                </button>
            </div>
            <div>
                <h3 className="font-semibold mb-2">Active Proposals</h3>
                {proposals.length === 0 ? (
                    <p className="text-gray-500">No active proposals.</p>
                ) : (
                    <ul>
                        {proposals.map((p: any, i) => (
                            <li key={i}>{p.title}</li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
