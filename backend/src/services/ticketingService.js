import { invokeSorobanContract } from './invokeService.js';
import { getDb } from '../database/connection.js';
import { cacheGet, cacheSet } from './cacheService.js';
import { EventEmitter } from 'events';

export const ticketingEvents = new EventEmitter();

export const ticketingService = {

  async createEvent(request) {
    const result = await invokeSorobanContract({
      contractId: request.contractId,
      functionName: 'create_event',
      args: {
        organizer: request.organizer,
        name: request.name,
        price: request.price,
        max_tickets: request.maxTickets,
        transferable: request.transferable
      }
    });

    if (result.success) {
      const eventId = result.parsed;
      const db = await getDb();
      await db.run(
        `INSERT INTO ticketing_events (id, organizer_address, name, price, max_tickets, transferable) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [eventId, request.organizer, request.name, request.price, request.maxTickets, request.transferable ? 1 : 0]
      );
      ticketingEvents.emit('update', { type: 'event_created', eventId, organizer: request.organizer });
    }


    return result;
  },

  async buyTicket(request) {
    const result = await invokeSorobanContract({
      contractId: request.contractId,
      functionName: 'buy_ticket',
      args: {
        buyer: request.buyer,
        event_id: request.eventId,
        payment_token: request.paymentToken
      }
    });

    if (result.success) {
      const ticketId = result.parsed;
      const db = await getDb();
      
      // Update local DB
      await db.run(
        `INSERT INTO ticketing_tickets (id, event_id, owner_address, purchase_price) 
         VALUES (?, ?, ?, ?)`,
        [ticketId, request.eventId, request.buyer, request.price]
      );
      
      await db.run(
        `UPDATE ticketing_events SET sold_tickets = sold_tickets + 1 WHERE id = ?`,
        [request.eventId]
      );
      ticketingEvents.emit('update', { type: 'ticket_purchased', ticketId, eventId: request.eventId });
    }


    return result;
  },

  async checkIn(request) {
    const result = await invokeSorobanContract({
      contractId: request.contractId,
      functionName: 'check_in',
      args: {
        organizer: request.organizer,
        ticket_id: request.ticketId
      }
    });

    if (result.success) {
      const db = await getDb();
      await db.run(
        `UPDATE ticketing_tickets SET is_used = 1 WHERE id = ?`,
        [request.ticketId]
      );
      await db.run(
        `INSERT INTO ticketing_checkins (ticket_id) VALUES (?)`,
        [request.ticketId]
      );
      ticketingEvents.emit('update', { type: 'checked_in', ticketId: request.ticketId });
    }


    return result;
  },

  async getAnalytics(eventId) {
    const cacheKey = `analytics:${eventId}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    const db = await getDb();
    const event = await db.get(`SELECT * FROM ticketing_events WHERE id = ?`, [eventId]);
    const tickets = await db.all(`SELECT * FROM ticketing_tickets WHERE event_id = ?`, [eventId]);
    const checkins = await db.all(
      `SELECT tc.* FROM ticketing_checkins tc 
       JOIN ticketing_tickets tt ON tc.ticket_id = tt.id 
       WHERE tt.event_id = ?`,
      [eventId]
    );

    const analytics = {
      event,
      totalSold: tickets.length,
      totalRevenue: tickets.reduce((sum, t) => sum + t.purchase_price, 0),
      attendanceRate: tickets.length > 0 ? (checkins.length / tickets.length) * 100 : 0,
      checkins: checkins.length,
      history: checkins.map(c => ({ time: c.checkin_time }))
    };

    await cacheSet(cacheKey, analytics, 300); // Cache for 5 mins
    return analytics;
  }
};
