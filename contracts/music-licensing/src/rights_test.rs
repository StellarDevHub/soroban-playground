use super::*;
use crate::rights::{LicenseKind, LicenseTerms, MusicMetadata, PublisherSplit, RightsError};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, vec,
};

fn metadata(env: &Env, first: &Address, second: &Address) -> MusicMetadata {
    MusicMetadata {
        isrc: String::from_str(env, "USABC2600001"),
        iswc: String::from_str(env, "T0345246801"),
        publisher_splits: vec![
            env,
            PublisherSplit {
                account: first.clone(),
                share: 6_000,
            },
            PublisherSplit {
                account: second.clone(),
                share: 4_000,
            },
        ],
    }
}

fn terms(env: &Env, kind: LicenseKind) -> LicenseTerms {
    LicenseTerms {
        kind,
        territory: String::from_str(env, "WORLD"),
        terms_uri: String::from_str(env, "https://example.com/music-license"),
        duration_seconds: 3_600,
    }
}

#[test]
fn purchase_routes_exact_payment_and_records_copyright_and_terms() {
    for kind in [LicenseKind::Sync, LicenseKind::CommercialPerformance] {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, MusicLicensingContract);
        let client = MusicLicensingContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let artist = Address::generate(&env);
        let publisher = Address::generate(&env);
        let buyer = Address::generate(&env);
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        token::StellarAssetClient::new(&env, &token_id).mint(&buyer, &101);
        let balances = token::TokenClient::new(&env, &token_id);
        client.init(&admin);
        let metadata = metadata(&env, &artist, &publisher);
        let terms = terms(&env, kind);
        let track = client.register_track_with_metadata(
            &artist,
            &String::from_str(&env, "Synthetic recording"),
            &101,
            &metadata,
            &terms,
            &token_id,
        );
        let license = client.purchase_rights_license(&buyer, &track);
        assert_eq!(license.rights.metadata, metadata);
        assert_eq!(license.rights.terms, terms);
        assert_eq!(license.paid_amount, 101);
        assert_eq!(license.expires_at, license.purchase_time + 3_600);
        assert_eq!(client.get_rights_license(&track, &buyer), license);
        assert_eq!(balances.balance(&artist), 60);
        assert_eq!(balances.balance(&publisher), 41);
        assert_eq!(balances.balance(&buyer), 0);
        assert_eq!(balances.balance(&id), 0);
        assert_eq!(
            client.try_purchase_rights_license(&buyer, &track),
            Err(Ok(RightsError::AlreadyRegistered))
        );
        assert_eq!(balances.balance(&artist), 60);
        // The legacy purchase cannot bypass payment on a metadata-backed track.
        assert!(client.try_purchase_license(&buyer, &track).is_err());
    }
}

#[test]
fn insufficient_balance_does_not_issue_license_or_pay_publishers() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MusicLicensingContract);
    let client = MusicLicensingContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let artist = Address::generate(&env);
    let publisher = Address::generate(&env);
    let buyer = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::StellarAssetClient::new(&env, &token_id).mint(&buyer, &100);
    client.init(&admin);
    let track = client.register_track_with_metadata(
        &artist,
        &String::from_str(&env, "Track"),
        &101,
        &metadata(&env, &artist, &publisher),
        &terms(&env, LicenseKind::Sync),
        &token_id,
    );
    assert_eq!(
        client.try_purchase_rights_license(&buyer, &track),
        Err(Ok(RightsError::PaymentFailed))
    );
    assert_eq!(
        client.try_get_rights_license(&track, &buyer),
        Err(Ok(RightsError::LicenseNotFound))
    );
    let balances = token::TokenClient::new(&env, &token_id);
    assert_eq!(balances.balance(&buyer), 100);
    assert_eq!(balances.balance(&artist), 0);
    assert_eq!(balances.balance(&publisher), 0);
    // Same buyer can retry after funding; the failed attempt left no record.
    token::StellarAssetClient::new(&env, &token_id).mint(&buyer, &1);
    client.purchase_rights_license(&buyer, &track);
    assert_eq!(balances.balance(&publisher), 41);
}

#[test]
fn later_recipient_failure_rolls_back_all_transfers_and_license() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MusicLicensingContract);
    let client = MusicLicensingContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let artist = Address::generate(&env);
    let publisher = Address::generate(&env);
    let buyer = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    token_contract
        .issuer()
        .set_flag(soroban_sdk::testutils::IssuerFlags::RevocableFlag);
    let token_id = token_contract.address();
    let asset = token::StellarAssetClient::new(&env, &token_id);
    asset.mint(&buyer, &101);
    asset.set_authorized(&publisher, &false);
    client.init(&admin);
    let track = client.register_track_with_metadata(
        &artist,
        &String::from_str(&env, "Track"),
        &101,
        &metadata(&env, &artist, &publisher),
        &terms(&env, LicenseKind::Sync),
        &token_id,
    );
    assert_eq!(
        client.try_purchase_rights_license(&buyer, &track),
        Err(Ok(RightsError::PaymentFailed))
    );
    let balances = token::TokenClient::new(&env, &token_id);
    assert_eq!(balances.balance(&buyer), 101);
    assert_eq!(balances.balance(&artist), 0);
    assert_eq!(balances.balance(&id), 0);
    assert_eq!(
        client.try_get_rights_license(&track, &buyer),
        Err(Ok(RightsError::LicenseNotFound))
    );
}

#[test]
fn rejects_invalid_recording_and_work_identifiers() {
    let env = Env::default();
    let mut m = metadata(&env, &Address::generate(&env), &Address::generate(&env));
    for isrc in [
        "",
        "usABC2600001",
        "US-ABC-26-00001",
        "USA!C2600001",
        "USABC2x00001",
        "USABC26000010",
    ] {
        m.isrc = String::from_str(&env, isrc);
        assert_eq!(
            rights::validate_metadata(&m),
            Err(RightsError::InvalidIsrc),
            "{isrc}"
        );
    }
    m.isrc = String::from_str(&env, "USABC2600001");
    for iswc in [
        "",
        "T-034.524.680-1",
        "T0345246802",
        "t0345246801",
        "T03452468x1",
    ] {
        m.iswc = String::from_str(&env, iswc);
        assert_eq!(
            rights::validate_metadata(&m),
            Err(RightsError::InvalidIswc),
            "{iswc}"
        );
    }
    m.iswc = String::from_str(&env, "T0345246801");
    assert_eq!(rights::validate_metadata(&m), Ok(()));
}

#[test]
fn publisher_table_rejects_duplicates_bad_totals_and_excess_recipients() {
    let env = Env::default();
    let first = Address::generate(&env);
    let mut m = metadata(&env, &first, &first);
    assert_eq!(
        rights::validate_metadata(&m),
        Err(RightsError::DuplicatePublisher)
    );
    m.publisher_splits = Vec::new(&env);
    assert_eq!(
        rights::validate_metadata(&m),
        Err(RightsError::InvalidSplits)
    );
    m = metadata(&env, &first, &Address::generate(&env));
    m.publisher_splits.set(
        1,
        PublisherSplit {
            account: Address::generate(&env),
            share: 3_999,
        },
    );
    assert_eq!(
        rights::validate_metadata(&m),
        Err(RightsError::InvalidSplits)
    );
    m.publisher_splits = Vec::new(&env);
    for index in 0..17 {
        m.publisher_splits.push_back(PublisherSplit {
            account: Address::generate(&env),
            share: if index == 16 { 9_984 } else { 1 },
        });
    }
    assert_eq!(
        rights::validate_metadata(&m),
        Err(RightsError::InvalidSplits)
    );
}

#[test]
fn allocation_conserves_one_atomic_unit_and_maximum_integer() {
    let env = Env::default();
    let m = metadata(&env, &Address::generate(&env), &Address::generate(&env));
    for amount in [1, 101, i128::MAX] {
        let payments = rights::allocate(&env, &m.publisher_splits, amount).unwrap();
        assert_eq!(
            payments.get(0).unwrap().amount + payments.get(1).unwrap().amount,
            amount
        );
        if amount == 1 {
            assert_eq!(payments.get(0).unwrap().amount, 0);
            assert_eq!(payments.get(1).unwrap().amount, 1);
        }
    }
    assert_eq!(
        rights::allocate(&env, &m.publisher_splits, 0),
        Err(RightsError::InvalidAmount)
    );
}

#[test]
fn agreement_boundaries_reject_credentials_and_invalid_duration() {
    let env = Env::default();
    let mut t = terms(&env, LicenseKind::Sync);
    for duration in [3_600, 315_360_000] {
        t.duration_seconds = duration;
        assert_eq!(rights::validate_terms(&t), Ok(()));
    }
    for duration in [3_599, 315_360_001] {
        t.duration_seconds = duration;
        assert_eq!(
            rights::validate_terms(&t),
            Err(RightsError::InvalidAgreement)
        );
    }
    t.duration_seconds = 3_600;
    for uri in [
        "http://example.com",
        "https://user:secret@example.com/license",
        "https:///path",
        "https://example.com/a b",
        "https://example.com/\\x",
    ] {
        t.terms_uri = String::from_str(&env, uri);
        assert_eq!(
            rights::validate_terms(&t),
            Err(RightsError::InvalidAgreement)
        );
    }
}

#[test]
fn paused_purchase_and_overflow_leave_no_paid_license() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MusicLicensingContract);
    let client = MusicLicensingContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let artist = Address::generate(&env);
    let buyer = Address::generate(&env);
    client.init(&admin);
    let track = client.register_track_with_metadata(
        &artist,
        &String::from_str(&env, "Track"),
        &101,
        &metadata(&env, &artist, &Address::generate(&env)),
        &terms(&env, LicenseKind::Sync),
        &Address::generate(&env),
    );
    client.pause(&admin);
    assert_eq!(
        client.try_purchase_rights_license(&buyer, &track),
        Err(Ok(RightsError::Paused))
    );
    client.unpause(&admin);
    env.ledger().with_mut(|ledger| ledger.timestamp = u64::MAX);
    assert_eq!(
        client.try_purchase_rights_license(&buyer, &track),
        Err(Ok(RightsError::Overflow))
    );
    assert_eq!(
        client.try_get_rights_license(&track, &buyer),
        Err(Ok(RightsError::LicenseNotFound))
    );
}

#[test]
fn metadata_registration_and_purchase_require_artist_and_buyer_authorization() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MusicLicensingContract);
    let client = MusicLicensingContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let artist = Address::generate(&env);
    let buyer = Address::generate(&env);
    client.init(&admin);
    let m = metadata(&env, &artist, &Address::generate(&env));
    let t = terms(&env, LicenseKind::Sync);
    let token = Address::generate(&env);
    let title = String::from_str(&env, "Track");
    let track = client.register_track_with_metadata(&artist, &title, &1, &m, &t, &token);
    env.mock_auths(&[]);
    assert!(client
        .try_register_track_with_metadata(&artist, &title, &1, &m, &t, &token)
        .is_err());
    assert!(client.try_purchase_rights_license(&buyer, &track).is_err());
    assert_eq!(
        client.try_get_rights_license(&track, &buyer),
        Err(Ok(RightsError::LicenseNotFound))
    );
}

#[test]
fn registering_metadata_rejects_bad_inputs_without_consuming_track_id() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MusicLicensingContract);
    let client = MusicLicensingContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let artist = Address::generate(&env);
    let mut m = metadata(&env, &artist, &Address::generate(&env));
    let t = terms(&env, LicenseKind::Sync);
    let token = Address::generate(&env);
    let title = String::from_str(&env, "Title");
    assert_eq!(
        client.try_register_track_with_metadata(&artist, &title, &1, &m, &t, &token),
        Err(Ok(RightsError::NotInitialized))
    );
    client.init(&admin);
    m.isrc = String::from_str(&env, "bad");
    assert_eq!(
        client.try_register_track_with_metadata(&artist, &title, &1, &m, &t, &token),
        Err(Ok(RightsError::InvalidIsrc))
    );
    m.isrc = String::from_str(&env, "USABC2600001");
    assert_eq!(
        client.try_register_track_with_metadata(&artist, &title, &0, &m, &t, &token),
        Err(Ok(RightsError::InvalidAmount))
    );
    assert_eq!(
        client.register_track_with_metadata(&artist, &title, &1, &m, &t, &token),
        1
    );
}

#[test]
fn contract_address_cannot_receive_its_own_royalty_payment() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MusicLicensingContract);
    let client = MusicLicensingContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let artist = Address::generate(&env);
    let buyer = Address::generate(&env);
    client.init(&admin);
    env.as_contract(&id, || {
        assert_eq!(
            rights::transfer_payment(&env, &Address::generate(&env), &id, 101, &Vec::new(&env)),
            Err(RightsError::Unauthorized)
        );
    });
    let track = client.register_track_with_metadata(
        &artist,
        &String::from_str(&env, "Track"),
        &101,
        &metadata(&env, &artist, &id),
        &terms(&env, LicenseKind::Sync),
        &Address::generate(&env),
    );
    assert_eq!(
        client.try_purchase_rights_license(&buyer, &track),
        Err(Ok(RightsError::InvalidSplits))
    );
    assert_eq!(
        client.try_get_rights_license(&track, &buyer),
        Err(Ok(RightsError::LicenseNotFound))
    );
}
