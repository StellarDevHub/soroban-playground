#![cfg(test)]
use super::*;
use soroban_sdk::testutils::{Address as _, Events};
use soroban_sdk::{vec, Env, IntoVal};

#[test]
fn test_event_creation_and_purchase() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    let buyer = Address::generate(&env);
    let contract_id = env.register_contract(None, EventTicketing);
    let client = EventTicketingClient::new(&env, &contract_id);

    client.init(&admin);

    let event_id = client.create_event(
        &organizer,
        &symbol_short!("Party"),
        &100,
        &10,
        &true,
    );

    assert_eq!(event_id, 1);

    let ticket_id = client.buy_ticket(&buyer, &event_id, &Address::generate(&env));
    assert_eq!(ticket_id, 1);

    let ticket = client.get_ticket(&ticket_id);
    assert_eq!(ticket.owner, buyer);
    assert_eq!(ticket.event_id, event_id);
}

#[test]
#[should_panic(expected = "Transfers disabled for this event")]
fn test_transfer_disabled() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let organizer = Address::generate(&env);
    let buyer = Address::generate(&env);
    let receiver = Address::generate(&env);
    let contract_id = env.register_contract(None, EventTicketing);
    let client = EventTicketingClient::new(&env, &contract_id);

    client.init(&admin);

    let event_id = client.create_event(
        &organizer,
        &symbol_short!("Party"),
        &100,
        &10,
        &false, // Not transferable
    );

    let ticket_id = client.buy_ticket(&buyer, &event_id, &Address::generate(&env));
    client.transfer_ticket(&buyer, &receiver, &ticket_id);
}
