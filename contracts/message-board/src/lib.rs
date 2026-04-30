// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, String, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Message content is empty.
    EmptyMessage = 1,
    /// The requested message ID does not exist.
    MessageNotFound = 2,
    /// Caller is not the original author of the message.
    Unauthorized = 3,
}

/// A single message stored on-chain.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Message {
    /// Address that posted the message.
    pub author: Address,
    /// The message text.
    pub content: String,
    /// Ledger timestamp when the message was posted.
    pub timestamp: u64,
}

/// Storage keys.
#[contracttype]
pub enum DataKey {
    /// Individual message by sequential ID.
    Message(u64),
    /// Global message counter — also the ID of the latest message.
    Counter,
}

#[contract]
pub struct MessageBoard;

#[contractimpl]
impl MessageBoard {
    /// Posts a new message to the board.
    ///
    /// # Arguments
    /// * `author`  - The address posting the message. Must authorise the call.
    /// * `content` - The message text. Must not be empty.
    ///
    /// # Returns
    /// The unique sequential ID assigned to the new message.
    ///
    /// # Errors
    /// Returns [`Error::EmptyMessage`] if `content` is empty.
    pub fn post(env: Env, author: Address, content: String) -> Result<u64, Error> {
        author.require_auth();

        if content.len() == 0 {
            return Err(Error::EmptyMessage);
        }

        // Increment counter to get new ID
        let mut counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::Counter)
            .unwrap_or(0);
        counter += 1;
        env.storage().persistent().set(&DataKey::Counter, &counter);

        let message = Message {
            author: author.clone(),
            content,
            timestamp: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Message(counter), &message);

        env.events()
            .publish((soroban_sdk::symbol_short!("posted"), counter), author);

        Ok(counter)
    }

    /// Retrieves a message by its ID.
    ///
    /// # Errors
    /// Returns [`Error::MessageNotFound`] if no message exists for that ID.
    pub fn get(env: Env, message_id: u64) -> Result<Message, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Message(message_id))
            .ok_or(Error::MessageNotFound)
    }

    /// Edits the content of an existing message.
    ///
    /// Only the original author can edit their message.
    ///
    /// # Errors
    /// Returns [`Error::MessageNotFound`] if the ID does not exist.
    /// Returns [`Error::Unauthorized`] if caller is not the original author.
    /// Returns [`Error::EmptyMessage`] if the new content is empty.
    pub fn edit(
        env: Env,
        author: Address,
        message_id: u64,
        new_content: String,
    ) -> Result<(), Error> {
        author.require_auth();

        let mut message: Message = env
            .storage()
            .persistent()
            .get(&DataKey::Message(message_id))
            .ok_or(Error::MessageNotFound)?;

        if message.author != author {
            return Err(Error::Unauthorized);
        }

        if new_content.len() == 0 {
            return Err(Error::EmptyMessage);
        }

        message.content = new_content;
        env.storage()
            .persistent()
            .set(&DataKey::Message(message_id), &message);

        env.events()
            .publish((soroban_sdk::symbol_short!("edited"), message_id), author);

        Ok(())
    }

    /// Deletes a message by ID.
    ///
    /// Only the original author can delete their message.
    ///
    /// # Errors
    /// Returns [`Error::MessageNotFound`] if the ID does not exist.
    /// Returns [`Error::Unauthorized`] if caller is not the original author.
    pub fn delete(env: Env, author: Address, message_id: u64) -> Result<(), Error> {
        author.require_auth();

        let message: Message = env
            .storage()
            .persistent()
            .get(&DataKey::Message(message_id))
            .ok_or(Error::MessageNotFound)?;

        if message.author != author {
            return Err(Error::Unauthorized);
        }

        env.storage()
            .persistent()
            .remove(&DataKey::Message(message_id));

        env.events()
            .publish((soroban_sdk::symbol_short!("deleted"), message_id), author);

        Ok(())
    }

    /// Returns the total number of messages ever posted.
    ///
    /// Note: this includes deleted messages since the counter never
    /// decrements. Use [`get`] to check if a specific ID still exists.
    pub fn count(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::Counter)
            .unwrap_or(0)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger as _}, Env, String};

    fn setup() -> (Env, Address, MessageBoardClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, MessageBoard);
        let client = MessageBoardClient::new(&env, &id);
        (env, id, client)
    }

    // ── post ─────────────────────────────────────────────────────────────────

    #[test]
    fn test_post_returns_sequential_ids() {
        let (env, _id, client) = setup();
        let author = Address::generate(&env);

        let id1 = client.post(&author, &String::from_str(&env, "first"));
        let id2 = client.post(&author, &String::from_str(&env, "second"));

        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
    }

    #[test]
    fn test_post_stores_message_correctly() {
        let (env, _id, client) = setup();
        let author = Address::generate(&env);
        let content = String::from_str(&env, "hello board");

        let msg_id = client.post(&author, &content);
        let stored = client.get(&msg_id);

        assert_eq!(stored.author, author);
        assert_eq!(stored.content, content);
    }

    #[test]
    fn test_post_empty_content_fails() {
        let (env, _id, client) = setup();
        let author = Address::generate(&env);

        let result = client.try_post(&author, &String::from_str(&env, ""));
        assert_eq!(result, Err(Ok(Error::EmptyMessage)));
    }

    #[test]
    fn test_post_records_timestamp() {
        let (env, _id, client) = setup();
        env.ledger().with_mut(|l| l.timestamp = 99_999);
        let author = Address::generate(&env);

        let msg_id = client.post(&author, &String::from_str(&env, "timed"));
        let stored = client.get(&msg_id);

        assert_eq!(stored.timestamp, 99_999);
    }

    // ── get ──────────────────────────────────────────────────────────────────

    #[test]
    fn test_get_missing_message_fails() {
        let (env, _id, client) = setup();

        let result = client.try_get(&42);
        assert_eq!(result, Err(Ok(Error::MessageNotFound)));
    }

    // ── edit ─────────────────────────────────────────────────────────────────

    #[test]
    fn test_edit_updates_content() {
        let (env, _id, client) = setup();
        let author = Address::generate(&env);

        let msg_id = client.post(&author, &String::from_str(&env, "original"));
        client.edit(&author, &msg_id, &String::from_str(&env, "updated"));

        let stored = client.get(&msg_id);
        assert_eq!(stored.content, String::from_str(&env, "updated"));
    }

    #[test]
    fn test_edit_by_non_author_fails() {
        let (env, _id, client) = setup();
        let author = Address::generate(&env);
        let stranger = Address::generate(&env);

        let msg_id = client.post(&author, &String::from_str(&env, "mine"));
        let result = client.try_edit(&stranger, &msg_id, &String::from_str(&env, "hacked"));
        assert_eq!(result, Err(Ok(Error::Unauthorized)));
    }

    #[test]
    fn test_edit_empty_content_fails() {
        let (env, _id, client) = setup();
        let author = Address::generate(&env);

        let msg_id = client.post(&author, &String::from_str(&env, "content"));
        let result = client.try_edit(&author, &msg_id, &String::from_str(&env, ""));
        assert_eq!(result, Err(Ok(Error::EmptyMessage)));
    }

    #[test]
    fn test_edit_missing_message_fails() {
        let (env, _id, client) = setup();
        let author = Address::generate(&env);

        let result = client.try_edit(&author, &99, &String::from_str(&env, "ghost"));
        assert_eq!(result, Err(Ok(Error::MessageNotFound)));
    }

    // ── delete ───────────────────────────────────────────────────────────────

    #[test]
    fn test_delete_removes_message() {
        let (env, _id, client) = setup();
        let author = Address::generate(&env);

        let msg_id = client.post(&author, &String::from_str(&env, "bye"));
        client.delete(&author, &msg_id);

        let result = client.try_get(&msg_id);
        assert_eq!(result, Err(Ok(Error::MessageNotFound)));
    }

    #[test]
    fn test_delete_by_non_author_fails() {
        let (env, _id, client) = setup();
        let author = Address::generate(&env);
        let stranger = Address::generate(&env);

        let msg_id = client.post(&author, &String::from_str(&env, "protected"));
        let result = client.try_delete(&stranger, &msg_id);
        assert_eq!(result, Err(Ok(Error::Unauthorized)));
    }

    #[test]
    fn test_delete_missing_message_fails() {
        let (env, _id, client) = setup();
        let author = Address::generate(&env);

        let result = client.try_delete(&author, &99);
        assert_eq!(result, Err(Ok(Error::MessageNotFound)));
    }

    // ── count ────────────────────────────────────────────────────────────────

    #[test]
    fn test_count_starts_at_zero() {
        let (env, _id, client) = setup();
        assert_eq!(client.count(), 0);
    }

    #[test]
    fn test_count_increments_on_post() {
        let (env, _id, client) = setup();
        let author = Address::generate(&env);

        client.post(&author, &String::from_str(&env, "one"));
        client.post(&author, &String::from_str(&env, "two"));

        assert_eq!(client.count(), 2);
    }

    #[test]
    fn test_count_does_not_decrement_on_delete() {
        let (env, _id, client) = setup();
        let author = Address::generate(&env);

        let msg_id = client.post(&author, &String::from_str(&env, "temp"));
        client.delete(&author, &msg_id);

        // Counter reflects total ever posted, not current active count
        assert_eq!(client.count(), 1);
    }

    // ── author independence ───────────────────────────────────────────────────

    #[test]
    fn test_multiple_authors_independent() {
        let (env, _id, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        let alice_id = client.post(&alice, &String::from_str(&env, "alice msg"));
        let bob_id = client.post(&bob, &String::from_str(&env, "bob msg"));

        assert_eq!(client.get(&alice_id).author, alice);
        assert_eq!(client.get(&bob_id).author, bob);
    }
}
