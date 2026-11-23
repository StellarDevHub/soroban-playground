use super::*;
use rights::PublisherSplit;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, vec,
};

fn metadata(env: &Env, artist: &Address, publisher: &Address) -> MusicMetadata {
    MusicMetadata {
        isrc: String::from_str(env, "GBXYZ2600002"),
        iswc: String::from_str(env, "T0345246801"),
        publisher_splits: vec![
            env,
            PublisherSplit {
                account: artist.clone(),
                share: 6_000,
            },
            PublisherSplit {
                account: publisher.clone(),
                share: 4_000,
            },
        ],
    }
}

fn terms(env: &Env, kind: LicenseKind) -> LicenseTerms {
    LicenseTerms {
        kind,
        territory: String::from_str(env, "GB"),
        terms_uri: String::from_str(env, "https://example.com/rights"),
        duration_seconds: 3_600,
    }
}

#[test]
fn song_revenue_uses_one_asset_and_rejects_mixed_asset_offers_without_side_effects() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MusicRoyalty);
    let client = MusicRoyaltyClient::new(&env, &id);
    client.initialize();
    let artist = Address::generate(&env);
    let publisher = Address::generate(&env);
    let buyer = Address::generate(&env);
    let other_buyer = Address::generate(&env);
    let song = String::from_str(&env, "single-asset-song");
    let other_song = String::from_str(&env, "other-song");
    let m = metadata(&env, &artist, &publisher);
    let t = terms(&env, LicenseKind::Sync);
    let first_asset = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let second_asset = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    client.register_song_with_metadata(&artist, &song, &String::from_str(&env, "Title"), &m);
    assert_eq!(client.get_song_payment_token(&song), None);
    assert_eq!(
        client.try_issue_rights_license(&artist, &song, &buyer, &t, &second_asset, &0),
        Err(Ok(RightsError::InvalidAmount))
    );
    assert_eq!(client.get_song_payment_token(&song), None);
    token::StellarAssetClient::new(&env, &first_asset).mint(&buyer, &101);
    token::StellarAssetClient::new(&env, &second_asset).mint(&other_buyer, &202);
    client.issue_rights_license(&artist, &song, &buyer, &t, &first_asset, &101);
    assert_eq!(
        client.get_song_payment_token(&song),
        Some(first_asset.clone())
    );
    // Reject a competing currency even before the first offer is purchased.
    assert_eq!(
        client.try_issue_rights_license(&artist, &song, &other_buyer, &t, &second_asset, &202),
        Err(Ok(RightsError::PaymentTokenMismatch))
    );
    assert_eq!(
        client.try_get_rights_agreement(&song, &other_buyer),
        Err(Ok(RightsError::LicenseNotFound))
    );
    assert!(client.try_get_license_info(&song, &other_buyer).is_err());
    assert_eq!(client.get_song_info(&song).total_royalty_earned, 0);
    client.purchase_rights_license(&song, &buyer);
    assert_eq!(client.get_revenue_info(&song).total_revenue, 101);
    // The same currency remains supported for a later buyer and price.
    token::StellarAssetClient::new(&env, &first_asset).mint(&other_buyer, &202);
    client.issue_rights_license(&artist, &song, &other_buyer, &t, &first_asset, &202);
    client.purchase_rights_license(&song, &other_buyer);
    let revenue = client.get_revenue_info(&song);
    assert_eq!(revenue.total_revenue, 303);
    assert_eq!(revenue.distributed_revenue, 303);
    assert_eq!(revenue.pending_distribution, 0);
    assert_eq!(client.get_song_info(&song).total_royalty_earned, 303);
    assert_eq!(
        token::TokenClient::new(&env, &first_asset).balance(&artist),
        181
    );
    assert_eq!(
        token::TokenClient::new(&env, &first_asset).balance(&publisher),
        122
    );
    assert_eq!(
        token::TokenClient::new(&env, &second_asset).balance(&other_buyer),
        202
    );
    assert_eq!(
        token::TokenClient::new(&env, &second_asset).balance(&artist),
        0
    );
    // A separate song may still use a different currency.
    client.register_song_with_metadata(&artist, &other_song, &String::from_str(&env, "Title"), &m);
    client.issue_rights_license(&artist, &other_song, &other_buyer, &t, &second_asset, &202);
    client.purchase_rights_license(&other_song, &other_buyer);
    assert_eq!(
        client.get_song_payment_token(&other_song),
        Some(second_asset.clone())
    );
    assert_eq!(client.get_revenue_info(&other_song).total_revenue, 202);
    // Expiration never permits a currency change on the original song.
    env.ledger()
        .with_mut(|ledger| ledger.timestamp += t.duration_seconds);
    assert_eq!(
        client.try_issue_rights_license(
            &artist,
            &song,
            &Address::generate(&env),
            &t,
            &second_asset,
            &202
        ),
        Err(Ok(RightsError::PaymentTokenMismatch))
    );
    assert_eq!(client.get_song_payment_token(&song), Some(first_asset));
}

#[test]
fn music_royalty_purchase_activates_license_and_routes_multi_creator_payment() {
    for kind in [LicenseKind::Sync, LicenseKind::CommercialPerformance] {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, MusicRoyalty);
        let client = MusicRoyaltyClient::new(&env, &id);
        client.initialize();
        let artist = Address::generate(&env);
        let publisher = Address::generate(&env);
        let buyer = Address::generate(&env);
        let token_id = env
            .register_stellar_asset_contract_v2(Address::generate(&env))
            .address();
        token::StellarAssetClient::new(&env, &token_id).mint(&buyer, &101);
        let song_id = String::from_str(&env, "synthetic-song");
        let m = metadata(&env, &artist, &publisher);
        let t = terms(&env, kind);
        client.register_song_with_metadata(&artist, &song_id, &String::from_str(&env, "Title"), &m);
        client.issue_rights_license(&artist, &song_id, &buyer, &t, &token_id, &101);
        assert_eq!(client.get_music_metadata(&song_id), m);
        assert!(!client.get_license_info(&song_id, &buyer).active);
        let payments = client.purchase_rights_license(&song_id, &buyer);
        assert_eq!(payments.get(0).unwrap().amount, 60);
        assert_eq!(payments.get(1).unwrap().amount, 41);
        let balances = token::TokenClient::new(&env, &token_id);
        assert_eq!(balances.balance(&artist), 60);
        assert_eq!(balances.balance(&publisher), 41);
        assert_eq!(balances.balance(&buyer), 0);
        assert_eq!(balances.balance(&id), 0);
        assert!(client.get_license_info(&song_id, &buyer).active);
        assert_eq!(client.get_song_info(&song_id).total_royalty_earned, 101);
        let revenue = client.get_revenue_info(&song_id);
        assert_eq!(revenue.total_revenue, 101);
        assert_eq!(revenue.distributed_revenue, 101);
        assert_eq!(revenue.pending_distribution, 0);
        let agreement = client.get_rights_agreement(&song_id, &buyer);
        assert!(agreement.purchased);
        assert_eq!(agreement.metadata, m);
        assert_eq!(agreement.terms, t);
        assert_eq!(
            client.try_purchase_rights_license(&song_id, &buyer),
            Err(Ok(RightsError::AlreadyRegistered))
        );
        assert_eq!(balances.balance(&publisher), 41);
    }
}

#[test]
fn unauthorized_artist_cannot_issue_or_overwrite_metadata_rights() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MusicRoyalty);
    let client = MusicRoyaltyClient::new(&env, &id);
    client.initialize();
    let artist = Address::generate(&env);
    let other = Address::generate(&env);
    let buyer = Address::generate(&env);
    let song_id = String::from_str(&env, "s");
    let m = metadata(&env, &artist, &other);
    client.register_song_with_metadata(&artist, &song_id, &String::from_str(&env, "Title"), &m);
    assert_eq!(
        client.try_issue_rights_license(
            &other,
            &song_id,
            &buyer,
            &terms(&env, LicenseKind::Sync),
            &Address::generate(&env),
            &1
        ),
        Err(Ok(RightsError::Unauthorized))
    );
    let splits = client.get_song_info(&song_id).splits;
    assert_eq!(
        client.try_register_song(
            &other,
            &song_id,
            &String::from_str(&env, "Replacement"),
            &splits
        ),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(
        client.try_issue_license(
            &other,
            &song_id,
            &buyer,
            &String::from_str(&env, "sync"),
            &0,
            &3_600
        ),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(client.get_music_metadata(&song_id), m);
    assert_eq!(
        client.try_get_rights_agreement(&song_id, &buyer),
        Err(Ok(RightsError::LicenseNotFound))
    );
}

#[test]
fn unfunded_purchase_keeps_offer_inactive_and_can_retry_after_funding() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MusicRoyalty);
    let client = MusicRoyaltyClient::new(&env, &id);
    client.initialize();
    let artist = Address::generate(&env);
    let publisher = Address::generate(&env);
    let buyer = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let song_id = String::from_str(&env, "s");
    client.register_song_with_metadata(
        &artist,
        &song_id,
        &String::from_str(&env, "Title"),
        &metadata(&env, &artist, &publisher),
    );
    client.issue_rights_license(
        &artist,
        &song_id,
        &buyer,
        &terms(&env, LicenseKind::CommercialPerformance),
        &token_id,
        &1,
    );
    assert_eq!(
        client.try_purchase_rights_license(&song_id, &buyer),
        Err(Ok(RightsError::PaymentFailed))
    );
    assert!(!client.get_rights_agreement(&song_id, &buyer).purchased);
    assert!(!client.get_license_info(&song_id, &buyer).active);
    assert_eq!(client.get_song_info(&song_id).total_royalty_earned, 0);
    token::StellarAssetClient::new(&env, &token_id).mint(&buyer, &1);
    client.purchase_rights_license(&song_id, &buyer);
    let balances = token::TokenClient::new(&env, &token_id);
    assert_eq!(balances.balance(&artist), 0);
    assert_eq!(balances.balance(&publisher), 1);
}

#[test]
fn offer_expiration_rejects_purchase_at_exact_boundary() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MusicRoyalty);
    let client = MusicRoyaltyClient::new(&env, &id);
    client.initialize();
    let artist = Address::generate(&env);
    let buyer = Address::generate(&env);
    let song = String::from_str(&env, "s");
    client.register_song_with_metadata(
        &artist,
        &song,
        &String::from_str(&env, "Title"),
        &metadata(&env, &artist, &Address::generate(&env)),
    );
    client.issue_rights_license(
        &artist,
        &song,
        &buyer,
        &terms(&env, LicenseKind::Sync),
        &Address::generate(&env),
        &1,
    );
    let expires = client.get_rights_agreement(&song, &buyer).expires_at;
    env.ledger().with_mut(|ledger| ledger.timestamp = expires);
    assert_eq!(
        client.try_purchase_rights_license(&song, &buyer),
        Err(Ok(RightsError::LicenseExpired))
    );
    assert!(!client.get_rights_agreement(&song, &buyer).purchased);
}

#[test]
fn simulated_legacy_revenue_cannot_change_paid_song_accounting() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MusicRoyalty);
    let client = MusicRoyaltyClient::new(&env, &id);
    client.initialize();
    let artist = Address::generate(&env);
    let buyer = Address::generate(&env);
    let song = String::from_str(&env, "s");
    client.register_song_with_metadata(
        &artist,
        &song,
        &String::from_str(&env, "Title"),
        &metadata(&env, &artist, &Address::generate(&env)),
    );
    assert_eq!(
        client.try_distribute_royalty(&song, &100),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(
        client.try_record_usage(&song, &buyer, &1, &100),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(client.get_song_info(&song).total_royalty_earned, 0);
}

#[test]
fn issuance_and_purchase_reject_missing_account_authorization() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MusicRoyalty);
    let client = MusicRoyaltyClient::new(&env, &id);
    client.initialize();
    let artist = Address::generate(&env);
    let buyer = Address::generate(&env);
    let song = String::from_str(&env, "s");
    let m = metadata(&env, &artist, &Address::generate(&env));
    let t = terms(&env, LicenseKind::Sync);
    let token = Address::generate(&env);
    client.register_song_with_metadata(&artist, &song, &String::from_str(&env, "Title"), &m);
    client.issue_rights_license(&artist, &song, &buyer, &t, &token, &1);
    env.mock_auths(&[]);
    assert!(client
        .try_issue_rights_license(&artist, &song, &Address::generate(&env), &t, &token, &1)
        .is_err());
    assert!(client.try_purchase_rights_license(&song, &buyer).is_err());
    assert!(!client.get_rights_agreement(&song, &buyer).purchased);
}

#[test]
fn rejected_metadata_does_not_register_or_replace_a_song() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MusicRoyalty);
    let client = MusicRoyaltyClient::new(&env, &id);
    client.initialize();
    let artist = Address::generate(&env);
    let song = String::from_str(&env, "s");
    let title = String::from_str(&env, "Title");
    let mut m = metadata(&env, &artist, &Address::generate(&env));
    m.iswc = String::from_str(&env, "T0345246802");
    assert_eq!(
        client.try_register_song_with_metadata(&artist, &song, &title, &m),
        Err(Ok(RightsError::InvalidIswc))
    );
    assert_eq!(
        client.try_get_music_metadata(&song),
        Err(Ok(RightsError::MetadataNotFound))
    );
    m.iswc = String::from_str(&env, "T0345246801");
    client.register_song_with_metadata(&artist, &song, &title, &m);
    assert_eq!(
        client.try_register_song_with_metadata(&artist, &song, &title, &m),
        Err(Ok(RightsError::AlreadyRegistered))
    );
}
