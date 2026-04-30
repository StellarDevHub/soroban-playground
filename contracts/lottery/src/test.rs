#![cfg(test)]

use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env};

use crate::{Lottery, LotteryClient};
use crate::types::{Error, RoundStatus};

const TICKET_PRICE: i128 = 10_000_000; // 1 XLM
const ROUND_DURATION: u64 = 3_600;     // 1 hour

fn setup() -> (Env, Address, LotteryClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, Lottery);
    let client = LotteryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

fn initialized_client() -> (Env, Address, LotteryClient<'static>) {
    let (env, admin, client) = setup();
    client.initialize(&admin, &TICKET_PRICE);
    (env, admin, client)
}

// ── Initialization ─────────────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let (_, admin, client) = setup();
    client.initialize(&admin, &TICKET_PRICE);
    assert!(client.is_initialized());
    assert_eq!(client.get_ticket_price(), TICKET_PRICE);
    assert!(!client.is_paused());
}

#[test]
fn test_double_initialize_fails() {
    let (_, admin, client) = setup();
    client.initialize(&admin, &TICKET_PRICE);
    assert_eq!(
        client.try_initialize(&admin, &TICKET_PRICE),
        Err(Ok(Error::AlreadyInitialized))
    );
}

#[test]
fn test_initialize_zero_price_fails() {
    let (_, admin, client) = setup();
    assert_eq!(
        client.try_initialize(&admin, &0i128),
        Err(Ok(Error::InvalidPrice))
    );
}

// ── Round lifecycle ────────────────────────────────────────────────────────────

#[test]
fn test_start_round() {
    let (env, _, client) = initialized_client();
    let round_id = client.start_round(&ROUND_DURATION);
    assert_eq!(round_id, 1);
    assert_eq!(client.get_round_count(), 1);

    let round = client.get_round(&round_id);
    assert_eq!(round.id, 1);
    assert_eq!(round.status, RoundStatus::Open);
    assert_eq!(round.ticket_price, TICKET_PRICE);
    assert_eq!(round.total_tickets, 0);
    assert_eq!(round.prize_pool, 0);
    assert!(!round.claimed);
}

#[test]
fn test_start_round_zero_duration_fails() {
    let (_, _, client) = initialized_client();
    assert_eq!(
        client.try_start_round(&0u64),
        Err(Ok(Error::InvalidDuration))
    );
}

#[test]
fn test_multiple_rounds_increment() {
    let (_, _, client) = initialized_client();
    assert_eq!(client.start_round(&ROUND_DURATION), 1);
    assert_eq!(client.start_round(&ROUND_DURATION), 2);
    assert_eq!(client.start_round(&ROUND_DURATION), 3);
    assert_eq!(client.get_round_count(), 3);
}

// ── Ticket purchasing ──────────────────────────────────────────────────────────

#[test]
fn test_buy_ticket() {
    let (env, _, client) = initialized_client();
    let round_id = client.start_round(&ROUND_DURATION);
    let buyer = Address::generate(&env);

    let ticket_id = client.buy_ticket(&buyer, &round_id);
    assert_eq!(ticket_id, 1);

    let round = client.get_round(&round_id);
    assert_eq!(round.total_tickets, 1);
    assert_eq!(round.prize_pool, TICKET_PRICE);

    assert_eq!(client.get_ticket_buyer(&round_id, &ticket_id), buyer);
}

#[test]
fn test_buy_multiple_tickets() {
    let (env, _, client) = initialized_client();
    let round_id = client.start_round(&ROUND_DURATION);

    let buyer_a = Address::generate(&env);
    let buyer_b = Address::generate(&env);
    let buyer_c = Address::generate(&env);

    let id_a = client.buy_ticket(&buyer_a, &round_id);
    let id_b = client.buy_ticket(&buyer_b, &round_id);
    let id_c = client.buy_ticket(&buyer_c, &round_id);

    assert_eq!((id_a, id_b, id_c), (1, 2, 3));

    let round = client.get_round(&round_id);
    assert_eq!(round.total_tickets, 3);
    assert_eq!(round.prize_pool, TICKET_PRICE * 3);
}

#[test]
fn test_buy_ticket_on_ended_round_fails() {
    let (env, _, client) = initialized_client();
    let round_id = client.start_round(&ROUND_DURATION);
    let buyer = Address::generate(&env);

    env.ledger().with_mut(|l| {
        l.timestamp += ROUND_DURATION + 1;
    });

    assert_eq!(
        client.try_buy_ticket(&buyer, &round_id),
        Err(Ok(Error::RoundNotOpen))
    );
}

#[test]
fn test_buy_ticket_on_completed_round_fails() {
    let (env, _, client) = initialized_client();
    let round_id = client.start_round(&ROUND_DURATION);
    let buyer = Address::generate(&env);
    client.buy_ticket(&buyer, &round_id);

    env.ledger().with_mut(|l| {
        l.timestamp += ROUND_DURATION + 1;
        l.sequence_number += 10;
    });
    client.draw_winner(&round_id);

    let buyer2 = Address::generate(&env);
    assert_eq!(
        client.try_buy_ticket(&buyer2, &round_id),
        Err(Ok(Error::RoundNotOpen))
    );
}

// ── Drawing the winner ────────────────────────────────────────────────────────

#[test]
fn test_draw_winner() {
    let (env, _, client) = initialized_client();
    let round_id = client.start_round(&ROUND_DURATION);
    let buyer = Address::generate(&env);
    client.buy_ticket(&buyer, &round_id);

    env.ledger().with_mut(|l| {
        l.timestamp += ROUND_DURATION + 1;
        l.sequence_number += 5;
    });

    let winner = client.draw_winner(&round_id);
    assert_eq!(winner, buyer);

    let round = client.get_round(&round_id);
    assert_eq!(round.status, RoundStatus::Completed);
    assert_eq!(round.winner, Some(buyer));
    assert!(round.winner_ticket_id.is_some());
}

#[test]
fn test_draw_winner_on_open_round_fails() {
    let (env, _, client) = initialized_client();
    let round_id = client.start_round(&ROUND_DURATION);
    let buyer = Address::generate(&env);
    client.buy_ticket(&buyer, &round_id);

    assert_eq!(
        client.try_draw_winner(&round_id),
        Err(Ok(Error::RoundStillOpen))
    );
}

#[test]
fn test_draw_winner_on_empty_round_cancels() {
    let (env, _, client) = initialized_client();
    let round_id = client.start_round(&ROUND_DURATION);

    env.ledger().with_mut(|l| {
        l.timestamp += ROUND_DURATION + 1;
    });

    assert_eq!(
        client.try_draw_winner(&round_id),
        Err(Ok(Error::NoTicketsSold))
    );

    let round = client.get_round(&round_id);
    assert_eq!(round.status, RoundStatus::Cancelled);
}

#[test]
fn test_draw_winner_twice_fails() {
    let (env, _, client) = initialized_client();
    let round_id = client.start_round(&ROUND_DURATION);
    let buyer = Address::generate(&env);
    client.buy_ticket(&buyer, &round_id);

    env.ledger().with_mut(|l| {
        l.timestamp += ROUND_DURATION + 1;
    });
    client.draw_winner(&round_id);

    assert_eq!(
        client.try_draw_winner(&round_id),
        Err(Ok(Error::RoundAlreadyDrawn))
    );
}

#[test]
fn test_draw_winner_distributes_among_all_tickets() {
    let (env, _, client) = initialized_client();
    let round_id = client.start_round(&ROUND_DURATION);

    let buyers: soroban_sdk::Vec<Address> = {
        let mut v = soroban_sdk::Vec::new(&env);
        for _ in 0..10 {
            let b = Address::generate(&env);
            client.buy_ticket(&b, &round_id);
            v.push_back(b);
        }
        v
    };

    env.ledger().with_mut(|l| {
        l.timestamp += ROUND_DURATION + 1;
        l.sequence_number += 7;
    });

    let winner = client.draw_winner(&round_id);
    let round = client.get_round(&round_id);

    assert_eq!(round.status, RoundStatus::Completed);
    assert_eq!(round.prize_pool, TICKET_PRICE * 10);

    // Winner must be one of the buyers.
    let ticket_id = round.winner_ticket_id.unwrap();
    assert!(ticket_id >= 1 && ticket_id <= 10);
    assert_eq!(client.get_ticket_buyer(&round_id, &ticket_id), winner);
}

// ── Prize claiming ─────────────────────────────────────────────────────────────

#[test]
fn test_claim_prize() {
    let (env, _, client) = initialized_client();
    let round_id = client.start_round(&ROUND_DURATION);
    let buyer = Address::generate(&env);
    client.buy_ticket(&buyer, &round_id);

    env.ledger().with_mut(|l| {
        l.timestamp += ROUND_DURATION + 1;
    });
    client.draw_winner(&round_id);

    let payout = client.claim_prize(&round_id, &buyer);
    assert_eq!(payout, TICKET_PRICE);

    let round = client.get_round(&round_id);
    assert!(round.claimed);
}

#[test]
fn test_claim_already_claimed_fails() {
    let (env, _, client) = initialized_client();
    let round_id = client.start_round(&ROUND_DURATION);
    let buyer = Address::generate(&env);
    client.buy_ticket(&buyer, &round_id);

    env.ledger().with_mut(|l| {
        l.timestamp += ROUND_DURATION + 1;
    });
    client.draw_winner(&round_id);
    client.claim_prize(&round_id, &buyer);

    assert_eq!(
        client.try_claim_prize(&round_id, &buyer),
        Err(Ok(Error::AlreadyClaimed))
    );
}

#[test]
fn test_claim_by_non_winner_fails() {
    let (env, _, client) = initialized_client();
    let round_id = client.start_round(&ROUND_DURATION);
    let buyer = Address::generate(&env);
    client.buy_ticket(&buyer, &round_id);

    env.ledger().with_mut(|l| {
        l.timestamp += ROUND_DURATION + 1;
    });
    client.draw_winner(&round_id);

    let non_winner = Address::generate(&env);
    assert_eq!(
        client.try_claim_prize(&round_id, &non_winner),
        Err(Ok(Error::NotWinner))
    );
}

#[test]
fn test_claim_on_uncompleted_round_fails() {
    let (env, _, client) = initialized_client();
    let round_id = client.start_round(&ROUND_DURATION);
    let buyer = Address::generate(&env);
    client.buy_ticket(&buyer, &round_id);

    assert_eq!(
        client.try_claim_prize(&round_id, &buyer),
        Err(Ok(Error::RoundNotCompleted))
    );
}

// ── Round cancellation ────────────────────────────────────────────────────────

#[test]
fn test_cancel_round() {
    let (_, _, client) = initialized_client();
    let round_id = client.start_round(&ROUND_DURATION);
    client.cancel_round(&round_id);

    let round = client.get_round(&round_id);
    assert_eq!(round.status, RoundStatus::Cancelled);
}

#[test]
fn test_cancel_completed_round_fails() {
    let (env, _, client) = initialized_client();
    let round_id = client.start_round(&ROUND_DURATION);
    let buyer = Address::generate(&env);
    client.buy_ticket(&buyer, &round_id);

    env.ledger().with_mut(|l| {
        l.timestamp += ROUND_DURATION + 1;
    });
    client.draw_winner(&round_id);

    assert_eq!(
        client.try_cancel_round(&round_id),
        Err(Ok(Error::RoundNotOpen))
    );
}

// ── Emergency pause ───────────────────────────────────────────────────────────

#[test]
fn test_pause_unpause() {
    let (_, _, client) = initialized_client();
    client.pause();
    assert!(client.is_paused());
    client.unpause();
    assert!(!client.is_paused());
}

#[test]
fn test_paused_blocks_ticket_purchase() {
    let (env, _, client) = initialized_client();
    let round_id = client.start_round(&ROUND_DURATION);
    client.pause();

    let buyer = Address::generate(&env);
    assert_eq!(
        client.try_buy_ticket(&buyer, &round_id),
        Err(Ok(Error::ContractPaused))
    );
}

#[test]
fn test_paused_blocks_new_rounds() {
    let (_, _, client) = initialized_client();
    client.pause();
    assert_eq!(
        client.try_start_round(&ROUND_DURATION),
        Err(Ok(Error::ContractPaused))
    );
}

// ── Analytics ─────────────────────────────────────────────────────────────────

#[test]
fn test_analytics_tracking() {
    let (env, _, client) = initialized_client();

    let r1 = client.start_round(&ROUND_DURATION);
    let buyer_a = Address::generate(&env);
    let buyer_b = Address::generate(&env);
    client.buy_ticket(&buyer_a, &r1);
    client.buy_ticket(&buyer_b, &r1);

    env.ledger().with_mut(|l| {
        l.timestamp += ROUND_DURATION + 1;
    });
    let winner = client.draw_winner(&r1);
    client.claim_prize(&r1, &winner);

    let r2 = client.start_round(&ROUND_DURATION);
    client.cancel_round(&r2);

    let a = client.get_analytics();
    assert_eq!(a.total_rounds, 2);
    assert_eq!(a.completed_rounds, 1);
    assert_eq!(a.cancelled_rounds, 1);
    assert_eq!(a.total_tickets_sold, 2);
    assert_eq!(a.total_prize_pool, TICKET_PRICE * 2);
    assert_eq!(a.total_prizes_claimed, TICKET_PRICE * 2);
}

#[test]
fn test_analytics_no_tickets_draw_cancels_round() {
    let (env, _, client) = initialized_client();
    let r1 = client.start_round(&ROUND_DURATION);

    env.ledger().with_mut(|l| {
        l.timestamp += ROUND_DURATION + 1;
    });
    let _ = client.try_draw_winner(&r1); // NoTicketsSold -> auto-cancel

    let a = client.get_analytics();
    assert_eq!(a.total_rounds, 1);
    assert_eq!(a.cancelled_rounds, 1);
    assert_eq!(a.completed_rounds, 0);
}
