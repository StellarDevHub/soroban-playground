// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{symbol_short, Env, Symbol};

use crate::{StorageUtils, StorageUtilsClient};
use crate::types::Error;

fn setup() -> (Env, StorageUtilsClient<'static>) {
    let env = Env::default();
    let contract_id = env.register_contract(None, StorageUtils);
    let client = StorageUtilsClient::new(&env, &contract_id);
    (env, client)
}

fn ns(env: &Env, s: &str) -> Symbol {
    Symbol::new(env, s)
}

// ── StorageMap ────────────────────────────────────────────────────────────────

#[test]
fn test_map_set_get() {
    let (env, client) = setup();
    let n = ns(&env, "mymap");
    client.map_set(&n, &1, &100);
    assert_eq!(client.map_get(&n, &1), 100);
}

#[test]
fn test_map_get_missing_key_fails() {
    let (env, client) = setup();
    let n = ns(&env, "mymap");
    let result = client.try_map_get(&n, &99);
    assert_eq!(result, Err(Ok(Error::KeyNotFound)));
}

#[test]
fn test_map_has() {
    let (env, client) = setup();
    let n = ns(&env, "mymap");
    assert!(!client.map_has(&n, &1));
    client.map_set(&n, &1, &42);
    assert!(client.map_has(&n, &1));
}

#[test]
fn test_map_remove() {
    let (env, client) = setup();
    let n = ns(&env, "mymap");
    client.map_set(&n, &1, &42);
    client.map_remove(&n, &1);
    assert!(!client.map_has(&n, &1));
}

#[test]
fn test_map_overwrite() {
    let (env, client) = setup();
    let n = ns(&env, "mymap");
    client.map_set(&n, &1, &10);
    client.map_set(&n, &1, &20);
    assert_eq!(client.map_get(&n, &1), 20);
}

#[test]
fn test_map_multiple_keys() {
    let (env, client) = setup();
    let n = ns(&env, "mymap");
    for i in 0i128..10 {
        client.map_set(&n, &i, &(i * 2));
    }
    for i in 0i128..10 {
        assert_eq!(client.map_get(&n, &i), i * 2);
    }
}

#[test]
fn test_map_namespaces_are_isolated() {
    let (env, client) = setup();
    let n1 = ns(&env, "map1");
    let n2 = ns(&env, "map2");
    client.map_set(&n1, &1, &111);
    client.map_set(&n2, &1, &222);
    assert_eq!(client.map_get(&n1, &1), 111);
    assert_eq!(client.map_get(&n2, &1), 222);
}

// ── StorageVec ────────────────────────────────────────────────────────────────

#[test]
fn test_vec_push_pop() {
    let (env, client) = setup();
    let n = ns(&env, "myvec");
    client.vec_push(&n, &10);
    client.vec_push(&n, &20);
    client.vec_push(&n, &30);
    assert_eq!(client.vec_len(&n), 3);
    assert_eq!(client.vec_pop(&n), 30);
    assert_eq!(client.vec_len(&n), 2);
}

#[test]
fn test_vec_get() {
    let (env, client) = setup();
    let n = ns(&env, "myvec");
    client.vec_push(&n, &100);
    client.vec_push(&n, &200);
    assert_eq!(client.vec_get(&n, &0), 100);
    assert_eq!(client.vec_get(&n, &1), 200);
}

#[test]
fn test_vec_set() {
    let (env, client) = setup();
    let n = ns(&env, "myvec");
    client.vec_push(&n, &1);
    client.vec_push(&n, &2);
    client.vec_set(&n, &0, &99);
    assert_eq!(client.vec_get(&n, &0), 99);
}

#[test]
fn test_vec_get_out_of_bounds_fails() {
    let (env, client) = setup();
    let n = ns(&env, "myvec");
    let result = client.try_vec_get(&n, &0);
    assert_eq!(result, Err(Ok(Error::IndexOutOfBounds)));
}

#[test]
fn test_vec_pop_empty_fails() {
    let (env, client) = setup();
    let n = ns(&env, "myvec");
    let result = client.try_vec_pop(&n);
    assert_eq!(result, Err(Ok(Error::IndexOutOfBounds)));
}

#[test]
fn test_vec_set_out_of_bounds_fails() {
    let (env, client) = setup();
    let n = ns(&env, "myvec");
    let result = client.try_vec_set(&n, &5, &99);
    assert_eq!(result, Err(Ok(Error::IndexOutOfBounds)));
}

#[test]
fn test_vec_push_returns_index() {
    let (env, client) = setup();
    let n = ns(&env, "myvec");
    assert_eq!(client.vec_push(&n, &10), 0);
    assert_eq!(client.vec_push(&n, &20), 1);
    assert_eq!(client.vec_push(&n, &30), 2);
}

#[test]
fn test_vec_len_empty() {
    let (env, client) = setup();
    let n = ns(&env, "myvec");
    assert_eq!(client.vec_len(&n), 0);
}

#[test]
fn test_vec_multiple_push_pop() {
    let (env, client) = setup();
    let n = ns(&env, "myvec");
    for i in 0i128..20 {
        client.vec_push(&n, &i);
    }
    assert_eq!(client.vec_len(&n), 20);
    for i in (0i128..20).rev() {
        assert_eq!(client.vec_pop(&n), i);
    }
    assert_eq!(client.vec_len(&n), 0);
}

#[test]
fn test_vec_namespaces_isolated() {
    let (env, client) = setup();
    let n1 = ns(&env, "vec1");
    let n2 = ns(&env, "vec2");
    client.vec_push(&n1, &1);
    client.vec_push(&n1, &2);
    client.vec_push(&n2, &10);
    assert_eq!(client.vec_len(&n1), 2);
    assert_eq!(client.vec_len(&n2), 1);
}

// ── StorageQueue ──────────────────────────────────────────────────────────────

#[test]
fn test_queue_fifo_order() {
    let (env, client) = setup();
    let n = ns(&env, "myq");
    client.queue_push(&n, &1);
    client.queue_push(&n, &2);
    client.queue_push(&n, &3);
    assert_eq!(client.queue_pop(&n), 1);
    assert_eq!(client.queue_pop(&n), 2);
    assert_eq!(client.queue_pop(&n), 3);
}

#[test]
fn test_queue_pop_empty_fails() {
    let (env, client) = setup();
    let n = ns(&env, "myq");
    let result = client.try_queue_pop(&n);
    assert_eq!(result, Err(Ok(Error::QueueEmpty)));
}

#[test]
fn test_queue_peek() {
    let (env, client) = setup();
    let n = ns(&env, "myq");
    client.queue_push(&n, &42);
    assert_eq!(client.queue_peek(&n), 42);
    assert_eq!(client.queue_len(&n), 1); // peek doesn't remove
}

#[test]
fn test_queue_peek_empty_fails() {
    let (env, client) = setup();
    let n = ns(&env, "myq");
    let result = client.try_queue_peek(&n);
    assert_eq!(result, Err(Ok(Error::QueueEmpty)));
}

#[test]
fn test_queue_len() {
    let (env, client) = setup();
    let n = ns(&env, "myq");
    assert_eq!(client.queue_len(&n), 0);
    client.queue_push(&n, &1);
    client.queue_push(&n, &2);
    assert_eq!(client.queue_len(&n), 2);
    client.queue_pop(&n);
    assert_eq!(client.queue_len(&n), 1);
}

#[test]
fn test_queue_interleaved_push_pop() {
    let (env, client) = setup();
    let n = ns(&env, "myq");
    client.queue_push(&n, &10);
    client.queue_push(&n, &20);
    assert_eq!(client.queue_pop(&n), 10);
    client.queue_push(&n, &30);
    assert_eq!(client.queue_pop(&n), 20);
    assert_eq!(client.queue_pop(&n), 30);
}

#[test]
fn test_queue_namespaces_isolated() {
    let (env, client) = setup();
    let n1 = ns(&env, "q1");
    let n2 = ns(&env, "q2");
    client.queue_push(&n1, &1);
    client.queue_push(&n2, &99);
    assert_eq!(client.queue_pop(&n1), 1);
    assert_eq!(client.queue_pop(&n2), 99);
}

// ── StorageStack ──────────────────────────────────────────────────────────────

#[test]
fn test_stack_lifo_order() {
    let (env, client) = setup();
    let n = ns(&env, "mystack");
    client.stack_push(&n, &1);
    client.stack_push(&n, &2);
    client.stack_push(&n, &3);
    assert_eq!(client.stack_pop(&n), 3);
    assert_eq!(client.stack_pop(&n), 2);
    assert_eq!(client.stack_pop(&n), 1);
}

#[test]
fn test_stack_pop_empty_fails() {
    let (env, client) = setup();
    let n = ns(&env, "mystack");
    let result = client.try_stack_pop(&n);
    assert_eq!(result, Err(Ok(Error::StackEmpty)));
}

#[test]
fn test_stack_peek() {
    let (env, client) = setup();
    let n = ns(&env, "mystack");
    client.stack_push(&n, &7);
    assert_eq!(client.stack_peek(&n), 7);
    assert_eq!(client.stack_len(&n), 1);
}

#[test]
fn test_stack_peek_empty_fails() {
    let (env, client) = setup();
    let n = ns(&env, "mystack");
    let result = client.try_stack_peek(&n);
    assert_eq!(result, Err(Ok(Error::StackEmpty)));
}

#[test]
fn test_stack_len() {
    let (env, client) = setup();
    let n = ns(&env, "mystack");
    assert_eq!(client.stack_len(&n), 0);
    client.stack_push(&n, &1);
    client.stack_push(&n, &2);
    assert_eq!(client.stack_len(&n), 2);
    client.stack_pop(&n);
    assert_eq!(client.stack_len(&n), 1);
}

#[test]
fn test_stack_namespaces_isolated() {
    let (env, client) = setup();
    let n1 = ns(&env, "stk1");
    let n2 = ns(&env, "stk2");
    client.stack_push(&n1, &10);
    client.stack_push(&n2, &20);
    assert_eq!(client.stack_pop(&n1), 10);
    assert_eq!(client.stack_pop(&n2), 20);
}

// ── StorageSet ────────────────────────────────────────────────────────────────

#[test]
fn test_set_add_has() {
    let (env, client) = setup();
    let n = ns(&env, "myset");
    assert!(!client.set_has(&n, &42));
    assert!(client.set_add(&n, &42));
    assert!(client.set_has(&n, &42));
}

#[test]
fn test_set_add_duplicate_returns_false() {
    let (env, client) = setup();
    let n = ns(&env, "myset");
    assert!(client.set_add(&n, &1));
    assert!(!client.set_add(&n, &1));
}

#[test]
fn test_set_remove() {
    let (env, client) = setup();
    let n = ns(&env, "myset");
    client.set_add(&n, &5);
    assert!(client.set_remove(&n, &5));
    assert!(!client.set_has(&n, &5));
}

#[test]
fn test_set_remove_missing_returns_false() {
    let (env, client) = setup();
    let n = ns(&env, "myset");
    assert!(!client.set_remove(&n, &99));
}

#[test]
fn test_set_len() {
    let (env, client) = setup();
    let n = ns(&env, "myset");
    assert_eq!(client.set_len(&n), 0);
    client.set_add(&n, &1);
    client.set_add(&n, &2);
    client.set_add(&n, &3);
    assert_eq!(client.set_len(&n), 3);
    client.set_remove(&n, &2);
    assert_eq!(client.set_len(&n), 2);
}

#[test]
fn test_set_multiple_values() {
    let (env, client) = setup();
    let n = ns(&env, "myset");
    for i in 0i128..10 {
        client.set_add(&n, &i);
    }
    assert_eq!(client.set_len(&n), 10);
    for i in 0i128..10 {
        assert!(client.set_has(&n, &i));
    }
}

#[test]
fn test_set_namespaces_isolated() {
    let (env, client) = setup();
    let n1 = ns(&env, "set1");
    let n2 = ns(&env, "set2");
    client.set_add(&n1, &1);
    assert!(client.set_has(&n1, &1));
    assert!(!client.set_has(&n2, &1));
}

// ── Cross-collection namespace isolation ──────────────────────────────────────

#[test]
fn test_map_and_vec_same_ns_isolated() {
    // Using the same namespace string for different collection types
    // should not interfere because the key structure differs.
    let (env, client) = setup();
    let n = ns(&env, "shared");
    client.map_set(&n, &0, &999);
    client.vec_push(&n, &111);
    // map key (ns, 0i128) vs vec idx key (ns, 0u32) — different types, no collision
    assert_eq!(client.map_get(&n, &0), 999);
    assert_eq!(client.vec_get(&n, &0), 111);
}
