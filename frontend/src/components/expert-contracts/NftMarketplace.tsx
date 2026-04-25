import React, { useState } from 'react';

export default function NftMarketplace() {
    const [listings, setListings] = useState([]);

    return (
        <div className="p-4 border rounded shadow">
            <h2 className="text-xl font-bold mb-4">NFT Marketplace</h2>
            <div className="mb-4">
                <button className="bg-blue-500 text-white px-4 py-2 rounded">
                    Create Listing
                </button>
            </div>
            <div>
                <h3 className="font-semibold mb-2">Active Listings</h3>
                {listings.length === 0 ? (
                    <p className="text-gray-500">No active listings.</p>
                ) : (
                    <ul>
                        {listings.map((l: any, i) => (
                            <li key={i}>{l.id} - {l.price}</li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
