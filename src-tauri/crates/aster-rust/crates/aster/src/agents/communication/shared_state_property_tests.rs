//! Property-based tests for Shared State Manager
//!
//! These tests validate the correctness properties defined in the design document
//! using the proptest framework.
//!
//! **Feature: agents-alignment**

#[cfg(test)]
mod property_tests {
    use crate::agents::communication::shared_state::{Lock, SharedStateManager};
    use chrono::{Duration, Utc};
    use proptest::prelude::*;
    use serde_json::{json, Value};
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    // Strategy for generating state keys
    fn key_strategy() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9_]{0,15}".prop_map(|s| s.to_string())
    }

    // Strategy for generating agent/holder IDs
    fn holder_strategy() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9_]{0,10}".prop_map(|s| s.to_string())
    }

    // Strategy for generating simple JSON values
    fn value_strategy() -> impl Strategy<Value = Value> {
        prop_oneof![
            Just(json!(null)),
            any::<bool>().prop_map(|b| json!(b)),
            any::<i64>().prop_map(|n| json!(n)),
            "[a-zA-Z0-9 ]{0,20}".prop_map(|s| json!(s)),
        ]
    }

    // Strategy for generating a set of unique keys
    fn key_set_strategy(min: usize, max: usize) -> impl Strategy<Value = Vec<String>> {
        prop::collection::hash_set(key_strategy(), min..max)
            .prop_map(|set| set.into_iter().collect())
    }

    // Strategy for generating key-value pairs
    fn key_value_pairs_strategy(
        min: usize,
        max: usize,
    ) -> impl Strategy<Value = Vec<(String, Value)>> {
        prop::collection::vec((key_strategy(), value_strategy()), min..max)
    }

    // **Property 15: Shared State Operations**
    //
    // *For any* key-value pair set in the shared state,
    // getting the key SHALL return the exact value that was set.
    //
    // **Validates: Requirements 4.1**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn property_15_get_returns_set_value(
            key in key_strategy(),
            value in value_strategy()
        ) {
            let mut manager = SharedStateManager::new();

            // Set the value
            manager.set(&key, value.clone());

            // Get should return the same value
            let retrieved = manager.get(&key);
            prop_assert!(retrieved.is_some());
            prop_assert_eq!(retrieved.unwrap(), value);
        }

        #[test]
        fn property_15_delete_removes_value(
            key in key_strategy(),
            value in value_strategy()
        ) {
            let mut manager = SharedStateManager::new();

            // Set and then delete
            manager.set(&key, value);
            let deleted = manager.delete(&key);

            // Delete should return true and value should be gone
            prop_assert!(deleted);
            prop_assert!(manager.get(&key).is_none());
        }

        #[test]
        fn property_15_keys_contains_all_set_keys(
            pairs in key_value_pairs_strategy(1, 20)
        ) {
            let mut manager = SharedStateManager::new();

            // Set all pairs
            let mut expected_keys: HashSet<String> = HashSet::new();
            for (key, value) in &pairs {
                manager.set(key.clone(), value.clone());
                expected_keys.insert(key.clone());
            }

            // Keys should contain all set keys
            let actual_keys: HashSet<String> = manager.keys().into_iter().collect();
            prop_assert_eq!(actual_keys, expected_keys);
        }

        #[test]
        fn property_15_has_returns_correct_status(
            key in key_strategy(),
            value in value_strategy()
        ) {
            let mut manager = SharedStateManager::new();

            // Initially should not have the key
            prop_assert!(!manager.has(&key));

            // After set, should have the key
            manager.set(&key, value);
            prop_assert!(manager.has(&key));

            // After delete, should not have the key
            manager.delete(&key);
            prop_assert!(!manager.has(&key));
        }

        #[test]
        fn property_15_clear_removes_all_keys(
            pairs in key_value_pairs_strategy(1, 20)
        ) {
            let mut manager = SharedStateManager::new();

            // Set all pairs
            for (key, value) in &pairs {
                manager.set(key.clone(), value.clone());
            }

            // Clear all
            manager.clear();

            // Should have no keys
            prop_assert!(manager.keys().is_empty());
        }

        #[test]
        fn property_15_overwrite_updates_value(
            key in key_strategy(),
            value1 in value_strategy(),
            value2 in value_strategy()
        ) {
            let mut manager = SharedStateManager::new();

            // Set initial value
            manager.set(&key, value1);

            // Overwrite with new value
            manager.set(&key, value2.clone());

            // Should return the new value
            let retrieved = manager.get(&key);
            prop_assert!(retrieved.is_some());
            prop_assert_eq!(retrieved.unwrap(), value2);
        }
    }

    // **Property 16: State Watch Notification**
    //
    // *For any* key with a registered watcher,
    // setting or deleting the value SHALL trigger the watcher callback.
    //
    // **Validates: Requirements 4.2, 4.4**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn property_16_watch_triggered_on_set(
            key in key_strategy(),
            value in value_strategy()
        ) {
            let mut manager = SharedStateManager::new();
            let counter = Arc::new(AtomicUsize::new(0));
            let counter_clone = counter.clone();

            // Register watcher
            let _handle = manager.watch(&key, move |_| {
                counter_clone.fetch_add(1, Ordering::SeqCst);
            });

            // Set value should trigger watcher
            manager.set(&key, value);

            prop_assert_eq!(counter.load(Ordering::SeqCst), 1);
        }

        #[test]
        fn property_16_watch_triggered_on_delete(
            key in key_strategy(),
            value in value_strategy()
        ) {
            let mut manager = SharedStateManager::new();
            let counter = Arc::new(AtomicUsize::new(0));
            let counter_clone = counter.clone();

            // Set initial value
            manager.set(&key, value);

            // Register watcher
            let _handle = manager.watch(&key, move |_| {
                counter_clone.fetch_add(1, Ordering::SeqCst);
            });

            // Delete should trigger watcher
            manager.delete(&key);

            prop_assert_eq!(counter.load(Ordering::SeqCst), 1);
        }

        #[test]
        fn property_16_unwatch_stops_notifications(
            key in key_strategy(),
            value1 in value_strategy(),
            value2 in value_strategy()
        ) {
            let mut manager = SharedStateManager::new();
            let counter = Arc::new(AtomicUsize::new(0));
            let counter_clone = counter.clone();

            // Register watcher
            let handle = manager.watch(&key, move |_| {
                counter_clone.fetch_add(1, Ordering::SeqCst);
            });

            // First set triggers watcher
            manager.set(&key, value1);
            prop_assert_eq!(counter.load(Ordering::SeqCst), 1);

            // Unwatch
            manager.unwatch(&handle);

            // Second set should not trigger watcher
            manager.set(&key, value2);
            prop_assert_eq!(counter.load(Ordering::SeqCst), 1);
        }

        #[test]
        fn property_16_multiple_watchers_all_triggered(
            key in key_strategy(),
            value in value_strategy(),
            num_watchers in 2usize..10usize
        ) {
            let mut manager = SharedStateManager::new();
            let counters: Vec<Arc<AtomicUsize>> = (0..num_watchers)
                .map(|_| Arc::new(AtomicUsize::new(0)))
                .collect();

            // Register multiple watchers
            for counter in &counters {
                let c = counter.clone();
                let _handle = manager.watch(&key, move |_| {
                    c.fetch_add(1, Ordering::SeqCst);
                });
            }

            // Set value should trigger all watchers
            manager.set(&key, value);

            for counter in &counters {
                prop_assert_eq!(counter.load(Ordering::SeqCst), 1);
            }
        }

        #[test]
        fn property_16_watcher_receives_correct_value(
            key in key_strategy(),
            value in value_strategy()
        ) {
            let mut manager = SharedStateManager::new();
            let received = Arc::new(std::sync::Mutex::new(None));
            let received_clone = received.clone();
            let expected_value = value.clone();

            // Register watcher that captures the value
            let _handle = manager.watch(&key, move |v| {
                *received_clone.lock().unwrap() = v;
            });

            // Set value
            manager.set(&key, value);

            // Watcher should have received the correct value
            let received_value = received.lock().unwrap().clone();
            prop_assert_eq!(received_value, Some(expected_value));
        }

        #[test]
        fn property_16_watcher_receives_none_on_delete(
            key in key_strategy(),
            value in value_strategy()
        ) {
            let mut manager = SharedStateManager::new();
            let received = Arc::new(std::sync::Mutex::new(Some(json!("initial"))));
            let received_clone = received.clone();

            // Set initial value
            manager.set(&key, value);

            // Register watcher
            let _handle = manager.watch(&key, move |v| {
                *received_clone.lock().unwrap() = v;
            });

            // Delete value
            manager.delete(&key);

            // Watcher should have received None
            let received_value = received.lock().unwrap().clone();
            prop_assert!(received_value.is_none());
        }
    }

    // **Property 17: Distributed Lock Exclusivity**
    //
    // *For any* key, only one holder can hold the lock at a time.
    // When a lock is released, the next waiter can acquire it.
    //
    // **Validates: Requirements 4.3, 4.5, 4.6**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn property_17_lock_exclusivity(
            key in key_strategy(),
            holder1 in holder_strategy(),
            holder2 in holder_strategy()
        ) {
            let mut manager = SharedStateManager::new();

            // First holder acquires lock
            let lock1 = manager.lock(&key, &holder1, None);
            prop_assert!(lock1.is_ok());
            prop_assert!(manager.is_locked(&key));

            // Second holder cannot acquire lock
            let lock2 = manager.lock(&key, &holder2, None);
            prop_assert!(lock2.is_err());

            // Release first lock
            manager.unlock(&lock1.unwrap()).unwrap();
            prop_assert!(!manager.is_locked(&key));

            // Now second holder can acquire
            let lock3 = manager.lock(&key, &holder2, None);
            prop_assert!(lock3.is_ok());
        }

        #[test]
        fn property_17_try_lock_returns_none_when_locked(
            key in key_strategy(),
            holder1 in holder_strategy(),
            holder2 in holder_strategy()
        ) {
            let mut manager = SharedStateManager::new();

            // First holder acquires lock
            let lock1 = manager.try_lock(&key, &holder1, None);
            prop_assert!(lock1.is_some());

            // Second holder try_lock returns None
            let lock2 = manager.try_lock(&key, &holder2, None);
            prop_assert!(lock2.is_none());
        }

        #[test]
        fn property_17_expired_lock_can_be_acquired(
            key in key_strategy(),
            holder1 in holder_strategy(),
            holder2 in holder_strategy()
        ) {
            let mut manager = SharedStateManager::new();

            // Create an expired lock manually
            let expired_lock = Lock {
                id: uuid::Uuid::new_v4().to_string(),
                holder: holder1.clone(),
                key: key.clone(),
                acquired_at: Utc::now() - Duration::seconds(10),
                expires_at: Some(Utc::now() - Duration::seconds(5)),
            };
            manager.insert_lock_for_test(expired_lock);

            // Expired lock should not be considered locked
            prop_assert!(!manager.is_locked(&key));

            // Another holder can acquire the lock
            let lock2 = manager.lock(&key, &holder2, None);
            prop_assert!(lock2.is_ok());
            prop_assert_eq!(lock2.unwrap().holder, holder2);
        }

        #[test]
        fn property_17_cleanup_removes_expired_locks(
            keys in key_set_strategy(1, 10),
            holder in holder_strategy()
        ) {
            let mut manager = SharedStateManager::new();

            // Create expired locks for all keys
            for key in &keys {
                let expired_lock = Lock {
                    id: uuid::Uuid::new_v4().to_string(),
                    holder: holder.clone(),
                    key: key.clone(),
                    acquired_at: Utc::now() - Duration::seconds(10),
                    expires_at: Some(Utc::now() - Duration::seconds(5)),
                };
                manager.insert_lock_for_test(expired_lock);
            }

            // Cleanup should remove all expired locks
            let cleaned = manager.cleanup_expired_locks();
            prop_assert_eq!(cleaned, keys.len());
            prop_assert!(manager.get_all_locks().is_empty());
        }

        #[test]
        fn property_17_lock_holder_matches(
            key in key_strategy(),
            holder in holder_strategy()
        ) {
            let mut manager = SharedStateManager::new();

            let lock = manager.lock(&key, &holder, None).unwrap();

            prop_assert_eq!(lock.key, key);
            prop_assert_eq!(lock.holder, holder);
            prop_assert!(!lock.id.is_empty());
        }

        #[test]
        fn property_17_unlock_requires_correct_lock(
            key in key_strategy(),
            holder in holder_strategy()
        ) {
            let mut manager = SharedStateManager::new();

            // Acquire lock
            let lock = manager.lock(&key, &holder, None).unwrap();

            // Create a fake lock with different ID
            let fake_lock = Lock {
                id: "fake-id".to_string(),
                holder: holder.clone(),
                key: key.clone(),
                acquired_at: Utc::now(),
                expires_at: None,
            };

            // Unlock with fake lock should fail
            let result = manager.unlock(&fake_lock);
            prop_assert!(result.is_err());

            // Original lock should still be held
            prop_assert!(manager.is_locked(&key));

            // Unlock with correct lock should succeed
            let result = manager.unlock(&lock);
            prop_assert!(result.is_ok());
        }
    }

    // Additional property tests for atomic operations
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn property_compare_and_swap_succeeds_with_correct_expected(
            key in key_strategy(),
            initial in any::<i64>(),
            new_value in any::<i64>()
        ) {
            let mut manager = SharedStateManager::new();

            // Set initial value
            manager.set(&key, json!(initial));

            // CAS with correct expected value should succeed
            let success = manager.compare_and_swap(&key, &json!(initial), json!(new_value));
            prop_assert!(success);
            prop_assert_eq!(manager.get(&key), Some(json!(new_value)));
        }

        #[test]
        fn property_compare_and_swap_fails_with_wrong_expected(
            key in key_strategy(),
            initial in any::<i64>(),
            wrong_expected in any::<i64>(),
            new_value in any::<i64>()
        ) {
            prop_assume!(initial != wrong_expected);

            let mut manager = SharedStateManager::new();

            // Set initial value
            manager.set(&key, json!(initial));

            // CAS with wrong expected value should fail
            let success = manager.compare_and_swap(&key, &json!(wrong_expected), json!(new_value));
            prop_assert!(!success);
            prop_assert_eq!(manager.get(&key), Some(json!(initial)));
        }

        #[test]
        fn property_increment_adds_delta(
            key in key_strategy(),
            initial in -1000i64..1000i64,
            delta in -100i64..100i64
        ) {
            let mut manager = SharedStateManager::new();

            // Set initial value
            manager.set(&key, json!(initial));

            // Increment
            let result = manager.increment(&key, delta);

            prop_assert_eq!(result, initial + delta);
            prop_assert_eq!(manager.get(&key), Some(json!(initial + delta)));
        }

        #[test]
        fn property_increment_initializes_to_delta_if_missing(
            key in key_strategy(),
            delta in -100i64..100i64
        ) {
            let mut manager = SharedStateManager::new();

            // Increment non-existent key
            let result = manager.increment(&key, delta);

            prop_assert_eq!(result, delta);
            prop_assert_eq!(manager.get(&key), Some(json!(delta)));
        }

        #[test]
        fn property_decrement_subtracts_delta(
            key in key_strategy(),
            initial in -1000i64..1000i64,
            delta in -100i64..100i64
        ) {
            let mut manager = SharedStateManager::new();

            // Set initial value
            manager.set(&key, json!(initial));

            // Decrement
            let result = manager.decrement(&key, delta);

            prop_assert_eq!(result, initial - delta);
            prop_assert_eq!(manager.get(&key), Some(json!(initial - delta)));
        }
    }

    // Property tests for statistics
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(50))]

        #[test]
        fn property_stats_reflect_state(
            pairs in key_value_pairs_strategy(1, 20),
            num_watchers in 1usize..5usize
        ) {
            let mut manager = SharedStateManager::new();

            // Set all pairs
            let mut unique_keys: HashSet<String> = HashSet::new();
            for (key, value) in &pairs {
                manager.set(key.clone(), value.clone());
                unique_keys.insert(key.clone());
            }

            // Add watchers to first key
            if let Some(first_key) = unique_keys.iter().next() {
                for _ in 0..num_watchers {
                    let _handle = manager.watch(first_key.clone(), |_| {});
                }
            }

            let stats = manager.get_stats();
            prop_assert_eq!(stats.state_size, unique_keys.len());
            prop_assert!(stats.total_watchers >= num_watchers);
        }
    }
}
