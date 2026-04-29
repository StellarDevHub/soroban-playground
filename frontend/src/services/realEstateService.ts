export const realEstateService = {
  async listProperty(data: any) {
    const response = await fetch('/api/real-estate/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },

  async buyShares(data: any) {
    const response = await fetch('/api/real-estate/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },

  async depositRent(data: any) {
    const response = await fetch('/api/real-estate/deposit-rent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },

  async getPortfolio(address: string) {
    const response = await fetch(`/api/real-estate/portfolio/${address}`);
    return response.json();
  }
};
