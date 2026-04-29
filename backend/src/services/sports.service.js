// Simulated service for sports prediction market
// In a real scenario, this would interact with the Soroban RPC or a cached database

const markets = [
    {
        id: 1,
        event_name: 'Lakers vs Warriors',
        outcomes: [
            { name: 'Lakers', total_stake: 5000 },
            { name: 'Warriors', total_stake: 7000 }
        ],
        status: 'Open',
        resolution_deadline: Math.floor(Date.now() / 1000) + 3600 * 24,
        created_at: Math.floor(Date.now() / 1000) - 3600
    },
    {
        id: 2,
        event_name: 'Real Madrid vs Barcelona',
        outcomes: [
            { name: 'Real Madrid', total_stake: 10000 },
            { name: 'Barcelona', total_stake: 9000 },
            { name: 'Draw', total_stake: 2000 }
        ],
        status: 'Open',
        resolution_deadline: Math.floor(Date.now() / 1000) + 3600 * 48,
        created_at: Math.floor(Date.now() / 1000) - 3600 * 5
    }
];

const getAllMarkets = async () => {
    return markets;
};

const getMarketOdds = async (id) => {
    const market = markets.find(m => m.id === parseInt(id));
    if (!market) throw new Error('Market not found');

    const totalStake = market.outcomes.reduce((acc, curr) => acc + curr.total_stake, 0);
    return market.outcomes.map(outcome => ({
        name: outcome.name,
        odds: totalStake > 0 ? (totalStake / outcome.total_stake).toFixed(2) : '2.00'
    }));
};

const getGlobalAnalytics = async () => {
    const totalVolume = markets.reduce((acc, m) => 
        acc + m.outcomes.reduce((a, o) => a + o.total_stake, 0), 0);
    
    return {
        total_active_markets: markets.length,
        total_volume_usdc: totalVolume,
        top_market: markets[1].event_name,
        recent_activity: [
            { type: 'bet', amount: 500, outcome: 'Real Madrid', time: '2 mins ago' },
            { type: 'bet', amount: 200, outcome: 'Warriors', time: '5 mins ago' }
        ]
    };
};

export default {
    getAllMarkets,
    getMarketOdds,
    getGlobalAnalytics
};
