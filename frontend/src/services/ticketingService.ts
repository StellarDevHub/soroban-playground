export const ticketingService = {
  async createEvent(data: any) {
    const response = await fetch('/api/ticketing/create-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },

  async buyTicket(data: any) {
    const response = await fetch('/api/ticketing/buy-ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },

  async getAnalytics(eventId: string) {
    const response = await fetch(`/api/ticketing/analytics/${eventId}`);
    return response.json();
  },

  async checkIn(data: any) {
    const response = await fetch('/api/ticketing/check-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  }
};
