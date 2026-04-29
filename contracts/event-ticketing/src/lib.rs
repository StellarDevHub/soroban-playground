#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Vec, token, Map};

#[cfg(test)]
mod test;


#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Event(u64),
    Ticket(u64),
    EventCount,
    TicketCount,
    EventTickets(u64), // Map event_id -> Vec<ticket_id>
    UserTickets(Address), // Map user -> Vec<ticket_id>
    Paused,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Event {
    pub id: u64,
    pub organizer: Address,
    pub name: Symbol,
    pub price: i128,
    pub max_tickets: u32,
    pub sold_tickets: u32,
    pub transferable: bool,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Ticket {
    pub id: u64,
    pub event_id: u64,
    pub owner: Address,
    pub is_used: bool,
    pub purchase_price: i128,
}

#[contract]
pub struct EventTicketing;

#[contractimpl]
impl EventTicketing {
    pub fn init(env: Env, admin: Address) {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::EventCount, &0u64);
        env.storage().instance().set(&DataKey::TicketCount, &0u64);
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    pub fn create_event(
        env: Env,
        organizer: Address,
        name: Symbol,
        price: i128,
        max_tickets: u32,
        transferable: bool,
    ) -> u64 {
        organizer.require_auth();
        Self::ensure_not_paused(&env);

        let mut count: u64 = env.storage().instance().get(&DataKey::EventCount).unwrap_or(0);
        count += 1;

        let event = Event {
            id: count,
            organizer: organizer.clone(),
            name,
            price,
            max_tickets,
            sold_tickets: 0,
            transferable,
            active: true,
        };

        env.storage().persistent().set(&DataKey::Event(count), &event);
        env.storage().instance().set(&DataKey::EventCount, &count);

        env.events().publish(
            (symbol_short!("ev_creat"), organizer),
            (count, price, max_tickets),
        );

        count
    }

    pub fn buy_ticket(env: Env, buyer: Address, event_id: u64, payment_token: Address) -> u64 {
        buyer.require_auth();
        Self::ensure_not_paused(&env);

        let mut event: Event = env.storage().persistent().get(&DataKey::Event(event_id)).expect("Event not found");
        if !event.active {
            panic!("Event not active");
        }
        if event.sold_tickets >= event.max_tickets {
            panic!("Sold out");
        }

        // Handle payment
        if event.price > 0 {
            let token_client = token::Client::new(&env, &payment_token);
            token_client.transfer(&buyer, &event.organizer, &event.price);
        }

        let mut ticket_count: u64 = env.storage().instance().get(&DataKey::TicketCount).unwrap_or(0);
        ticket_count += 1;

        let ticket = Ticket {
            id: ticket_count,
            event_id,
            owner: buyer.clone(),
            is_used: false,
            purchase_price: event.price,
        };

        event.sold_tickets += 1;
        env.storage().persistent().set(&DataKey::Event(event_id), &event);
        env.storage().persistent().set(&DataKey::Ticket(ticket_count), &ticket);
        env.storage().instance().set(&DataKey::TicketCount, &ticket_count);

        // Update user tickets
        let mut user_tickets: Vec<u64> = env.storage().persistent().get(&DataKey::UserTickets(buyer.clone())).unwrap_or(Vec::new(&env));
        user_tickets.push_back(ticket_count);
        env.storage().persistent().set(&DataKey::UserTickets(buyer.clone()), &user_tickets);

        env.events().publish(
            (symbol_short!("tk_buy"), buyer),
            (ticket_count, event_id, event.price),
        );

        ticket_count
    }

    pub fn transfer_ticket(env: Env, from: Address, to: Address, ticket_id: u64) {
        from.require_auth();
        Self::ensure_not_paused(&env);

        let mut ticket: Ticket = env.storage().persistent().get(&DataKey::Ticket(ticket_id)).expect("Ticket not found");
        if ticket.owner != from {
            panic!("Not the owner");
        }
        if ticket.is_used {
            panic!("Ticket already used");
        }

        let event: Event = env.storage().persistent().get(&DataKey::Event(ticket.event_id)).expect("Event not found");
        if !event.transferable {
            panic!("Transfers disabled for this event");
        }

        // Anti-scalping: restricted to zero-profit transfers or specific mechanism
        // For this demo, we'll just allow it but log it. 
        // Real implementation might cap resale price if a marketplace was involved.

        ticket.owner = to.clone();
        env.storage().persistent().set(&DataKey::Ticket(ticket_id), &ticket);

        // Update from user tickets
        let mut from_tickets: Vec<u64> = env.storage().persistent().get(&DataKey::UserTickets(from.clone())).unwrap();
        let index = from_tickets.first_index_of(ticket_id).expect("Ticket not in user list");
        from_tickets.remove(index);
        env.storage().persistent().set(&DataKey::UserTickets(from.clone()), &from_tickets);

        // Update to user tickets
        let mut to_tickets: Vec<u64> = env.storage().persistent().get(&DataKey::UserTickets(to.clone())).unwrap_or(Vec::new(&env));
        to_tickets.push_back(ticket_id);
        env.storage().persistent().set(&DataKey::UserTickets(to.clone()), &to_tickets);

        env.events().publish(
            (symbol_short!("tk_trans"), from),
            (ticket_id, to),
        );
    }

    pub fn check_in(env: Env, organizer: Address, ticket_id: u64) {
        organizer.require_auth();
        
        let mut ticket: Ticket = env.storage().persistent().get(&DataKey::Ticket(ticket_id)).expect("Ticket not found");
        let event: Event = env.storage().persistent().get(&DataKey::Event(ticket.event_id)).expect("Event not found");
        
        if event.organizer != organizer {
            panic!("Not the organizer");
        }
        if ticket.is_used {
            panic!("Already checked in");
        }

        ticket.is_used = true;
        env.storage().persistent().set(&DataKey::Ticket(ticket_id), &ticket);

        env.events().publish(
            (symbol_short!("checkin"), organizer),
            ticket_id,
        );
    }

    pub fn set_paused(env: Env, admin: Address, paused: bool) {
        admin.require_auth();
        let contract_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != contract_admin {
            panic!("Not admin");
        }
        env.storage().instance().set(&DataKey::Paused, &paused);
    }

    pub fn get_event(env: Env, event_id: u64) -> Event {
        env.storage().persistent().get(&DataKey::Event(event_id)).expect("Event not found")
    }

    pub fn get_ticket(env: Env, ticket_id: u64) -> Ticket {
        env.storage().persistent().get(&DataKey::Ticket(ticket_id)).expect("Ticket not found")
    }

    pub fn get_user_tickets(env: Env, user: Address) -> Vec<u64> {
        env.storage().persistent().get(&DataKey::UserTickets(user)).unwrap_or(Vec::new(&env))
    }

    fn ensure_not_paused(env: &Env) {
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        if paused {
            panic!("Contract is paused");
        }
    }
}
