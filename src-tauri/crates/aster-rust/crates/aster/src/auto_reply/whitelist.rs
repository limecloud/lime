//! 白名单管理器
//!
//! 管理允许触发自动回复的用户列表。
//!
//! # 功能
//!
//! - 维护允许触发自动回复的用户 ID 集合
//! - 空白名单时允许所有用户（禁用白名单检查）
//! - 非空白名单时只允许白名单中的用户
//! - 支持动态添加/移除用户
//!
//! # 示例
//!
//! ```rust
//! use aster::auto_reply::WhitelistManager;
//!
//! // 创建空白名单（允许所有用户）
//! let mut whitelist = WhitelistManager::new();
//! assert!(whitelist.is_allowed("any_user"));
//!
//! // 添加用户后，只允许白名单中的用户
//! whitelist.add_user("user1".to_string());
//! assert!(whitelist.is_allowed("user1"));
//! assert!(!whitelist.is_allowed("user2"));
//!
//! // 清空白名单后，再次允许所有用户
//! whitelist.clear();
//! assert!(whitelist.is_allowed("any_user"));
//! ```

use std::collections::HashSet;

/// 白名单管理器
///
/// 管理允许触发自动回复的用户列表。
/// 当白名单为空时，所有用户都被允许（相当于禁用白名单检查）。
/// 当白名单非空时，只有白名单中的用户才被允许。
#[derive(Debug, Clone)]
pub struct WhitelistManager {
    /// 允许的用户 ID 集合
    allowed_users: HashSet<String>,
}

impl Default for WhitelistManager {
    fn default() -> Self {
        Self::new()
    }
}

impl WhitelistManager {
    /// 创建新的白名单管理器
    ///
    /// 创建一个空的白名单，此时所有用户都被允许。
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::auto_reply::WhitelistManager;
    ///
    /// let whitelist = WhitelistManager::new();
    /// assert!(whitelist.is_allowed("any_user"));
    /// ```
    pub fn new() -> Self {
        Self {
            allowed_users: HashSet::new(),
        }
    }

    /// 从用户列表创建白名单管理器
    ///
    /// # 参数
    ///
    /// * `users` - 初始白名单用户 ID 列表
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::auto_reply::WhitelistManager;
    ///
    /// let whitelist = WhitelistManager::from_users(vec![
    ///     "user1".to_string(),
    ///     "user2".to_string(),
    /// ]);
    /// assert!(whitelist.is_allowed("user1"));
    /// assert!(!whitelist.is_allowed("user3"));
    /// ```
    pub fn from_users(users: Vec<String>) -> Self {
        Self {
            allowed_users: users.into_iter().collect(),
        }
    }

    /// 检查用户是否在白名单中
    ///
    /// 当白名单为空时，所有用户都被允许。
    /// 当白名单非空时，只有白名单中的用户才被允许。
    ///
    /// # 参数
    ///
    /// * `user_id` - 要检查的用户 ID
    ///
    /// # 返回值
    ///
    /// 如果用户被允许则返回 `true`，否则返回 `false`。
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::auto_reply::WhitelistManager;
    ///
    /// let mut whitelist = WhitelistManager::new();
    ///
    /// // 空白名单时允许所有用户
    /// assert!(whitelist.is_allowed("any_user"));
    ///
    /// // 添加用户后只允许白名单中的用户
    /// whitelist.add_user("allowed_user".to_string());
    /// assert!(whitelist.is_allowed("allowed_user"));
    /// assert!(!whitelist.is_allowed("other_user"));
    /// ```
    pub fn is_allowed(&self, user_id: &str) -> bool {
        self.allowed_users.is_empty() || self.allowed_users.contains(user_id)
    }

    /// 检查白名单是否启用
    ///
    /// 当白名单非空时，白名单检查被启用。
    ///
    /// # 返回值
    ///
    /// 如果白名单非空则返回 `true`，否则返回 `false`。
    pub fn is_enabled(&self) -> bool {
        !self.allowed_users.is_empty()
    }

    /// 添加用户到白名单
    ///
    /// # 参数
    ///
    /// * `user_id` - 要添加的用户 ID
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::auto_reply::WhitelistManager;
    ///
    /// let mut whitelist = WhitelistManager::new();
    /// whitelist.add_user("user1".to_string());
    /// assert!(whitelist.is_allowed("user1"));
    /// ```
    pub fn add_user(&mut self, user_id: String) {
        self.allowed_users.insert(user_id);
    }

    /// 从白名单移除用户
    ///
    /// # 参数
    ///
    /// * `user_id` - 要移除的用户 ID
    ///
    /// # 返回值
    ///
    /// 如果用户存在并被移除则返回 `true`，否则返回 `false`。
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::auto_reply::WhitelistManager;
    ///
    /// let mut whitelist = WhitelistManager::from_users(vec!["user1".to_string()]);
    /// assert!(whitelist.remove_user("user1"));
    /// assert!(!whitelist.remove_user("user1")); // 已经移除
    /// ```
    pub fn remove_user(&mut self, user_id: &str) -> bool {
        self.allowed_users.remove(user_id)
    }

    /// 获取所有白名单用户
    ///
    /// # 返回值
    ///
    /// 返回白名单中所有用户 ID 的引用列表。
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::auto_reply::WhitelistManager;
    ///
    /// let whitelist = WhitelistManager::from_users(vec![
    ///     "user1".to_string(),
    ///     "user2".to_string(),
    /// ]);
    /// let users = whitelist.list_users();
    /// assert_eq!(users.len(), 2);
    /// ```
    pub fn list_users(&self) -> Vec<&String> {
        self.allowed_users.iter().collect()
    }

    /// 获取白名单用户数量
    ///
    /// # 返回值
    ///
    /// 返回白名单中的用户数量。
    pub fn len(&self) -> usize {
        self.allowed_users.len()
    }

    /// 检查白名单是否为空
    ///
    /// # 返回值
    ///
    /// 如果白名单为空则返回 `true`，否则返回 `false`。
    pub fn is_empty(&self) -> bool {
        self.allowed_users.is_empty()
    }

    /// 清空白名单
    ///
    /// 清空后所有用户都将被允许。
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::auto_reply::WhitelistManager;
    ///
    /// let mut whitelist = WhitelistManager::from_users(vec!["user1".to_string()]);
    /// assert!(!whitelist.is_allowed("user2"));
    ///
    /// whitelist.clear();
    /// assert!(whitelist.is_allowed("user2")); // 清空后允许所有用户
    /// ```
    pub fn clear(&mut self) {
        self.allowed_users.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // ============================================================================
    // Property-Based Tests
    // ============================================================================
    // Feature: auto-reply-mechanism, Property 3: 白名单操作一致性
    // **Validates: Requirements 3.1-3.6**

    /// 白名单操作类型
    #[derive(Debug, Clone)]
    enum WhitelistOp {
        Add(String),
        Remove(String),
        Clear,
    }

    /// 生成有效的用户 ID
    fn arb_user_id() -> impl Strategy<Value = String> {
        "[a-zA-Z0-9_]{1,20}".prop_map(|s| s)
    }

    /// 生成白名单操作
    fn arb_whitelist_op() -> impl Strategy<Value = WhitelistOp> {
        prop_oneof![
            arb_user_id().prop_map(WhitelistOp::Add),
            arb_user_id().prop_map(WhitelistOp::Remove),
            Just(WhitelistOp::Clear),
        ]
    }

    /// 生成操作序列
    fn arb_op_sequence() -> impl Strategy<Value = Vec<WhitelistOp>> {
        prop::collection::vec(arb_whitelist_op(), 0..50)
    }

    /// 应用操作到白名单，返回预期的用户集合
    fn apply_ops_to_set(ops: &[WhitelistOp]) -> std::collections::HashSet<String> {
        let mut set = std::collections::HashSet::new();
        for op in ops {
            match op {
                WhitelistOp::Add(user_id) => {
                    set.insert(user_id.clone());
                }
                WhitelistOp::Remove(user_id) => {
                    set.remove(user_id);
                }
                WhitelistOp::Clear => {
                    set.clear();
                }
            }
        }
        set
    }

    /// 应用操作到 WhitelistManager
    fn apply_ops_to_whitelist(whitelist: &mut WhitelistManager, ops: &[WhitelistOp]) {
        for op in ops {
            match op {
                WhitelistOp::Add(user_id) => {
                    whitelist.add_user(user_id.clone());
                }
                WhitelistOp::Remove(user_id) => {
                    whitelist.remove_user(user_id);
                }
                WhitelistOp::Clear => {
                    whitelist.clear();
                }
            }
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(20))]

        /// Property 3.1: 添加用户后 is_allowed 返回 true
        /// **Validates: Requirements 3.1, 3.4**
        #[test]
        fn prop_add_user_then_allowed(user_id in arb_user_id()) {
            let mut whitelist = WhitelistManager::new();
            whitelist.add_user(user_id.clone());

            // 添加后该用户应该被允许
            prop_assert!(whitelist.is_allowed(&user_id));
        }

        /// Property 3.2: 空白名单允许所有用户
        /// **Validates: Requirement 3.2**
        #[test]
        fn prop_empty_whitelist_allows_all(user_id in arb_user_id()) {
            let whitelist = WhitelistManager::new();

            // 空白名单应该允许任何用户
            prop_assert!(whitelist.is_allowed(&user_id));
            prop_assert!(whitelist.is_empty());
        }

        /// Property 3.3: 非空白名单只允许白名单中的用户
        /// **Validates: Requirement 3.3**
        #[test]
        fn prop_non_empty_whitelist_restricts(
            allowed_user in arb_user_id(),
            other_user in arb_user_id()
        ) {
            // 确保两个用户不同
            prop_assume!(allowed_user != other_user);

            let whitelist = WhitelistManager::from_users(vec![allowed_user.clone()]);

            // 白名单中的用户应该被允许
            prop_assert!(whitelist.is_allowed(&allowed_user));
            // 不在白名单中的用户应该被拒绝
            prop_assert!(!whitelist.is_allowed(&other_user));
        }

        /// Property 3.4: 移除用户后 is_allowed 返回 false（如果白名单非空）
        /// **Validates: Requirements 3.3, 3.5**
        #[test]
        fn prop_remove_user_then_not_allowed(
            user_to_remove in arb_user_id(),
            other_user in arb_user_id()
        ) {
            // 确保两个用户不同
            prop_assume!(user_to_remove != other_user);

            let mut whitelist = WhitelistManager::from_users(vec![
                user_to_remove.clone(),
                other_user.clone(),
            ]);

            // 移除前应该被允许
            prop_assert!(whitelist.is_allowed(&user_to_remove));

            // 移除用户
            whitelist.remove_user(&user_to_remove);

            // 移除后应该不被允许（因为白名单非空）
            prop_assert!(!whitelist.is_allowed(&user_to_remove));
            // 其他用户仍然被允许
            prop_assert!(whitelist.is_allowed(&other_user));
        }

        /// Property 3.5: 移除最后一个用户后允许所有用户
        /// **Validates: Requirements 3.2, 3.5**
        #[test]
        fn prop_remove_last_user_allows_all(
            user_id in arb_user_id(),
            test_user in arb_user_id()
        ) {
            let mut whitelist = WhitelistManager::from_users(vec![user_id.clone()]);

            // 移除前，非白名单用户不被允许
            if user_id != test_user {
                prop_assert!(!whitelist.is_allowed(&test_user));
            }

            // 移除最后一个用户
            whitelist.remove_user(&user_id);

            // 白名单为空后，所有用户都被允许
            prop_assert!(whitelist.is_empty());
            prop_assert!(whitelist.is_allowed(&test_user));
            prop_assert!(whitelist.is_allowed(&user_id));
        }

        /// Property 3.6: 操作序列与集合语义一致
        /// **Validates: Requirements 3.1-3.6**
        #[test]
        fn prop_operations_consistent_with_set_semantics(
            ops in arb_op_sequence(),
            test_users in prop::collection::vec(arb_user_id(), 1..10)
        ) {
            let mut whitelist = WhitelistManager::new();

            // 应用操作序列
            apply_ops_to_whitelist(&mut whitelist, &ops);

            // 计算预期的集合状态
            let expected_set = apply_ops_to_set(&ops);

            // 验证白名单状态与预期集合一致
            prop_assert_eq!(whitelist.len(), expected_set.len());
            prop_assert_eq!(whitelist.is_empty(), expected_set.is_empty());

            // 验证每个测试用户的 is_allowed 结果
            for user in &test_users {
                let expected_allowed = expected_set.is_empty() || expected_set.contains(user);
                prop_assert_eq!(
                    whitelist.is_allowed(user),
                    expected_allowed,
                    "User {} should be {} but was {}",
                    user,
                    if expected_allowed { "allowed" } else { "not allowed" },
                    if whitelist.is_allowed(user) { "allowed" } else { "not allowed" }
                );
            }
        }

        /// Property 3.7: 重复添加用户是幂等的
        /// **Validates: Requirement 3.4**
        #[test]
        fn prop_add_user_idempotent(user_id in arb_user_id(), times in 1usize..10) {
            let mut whitelist = WhitelistManager::new();

            // 多次添加同一用户
            for _ in 0..times {
                whitelist.add_user(user_id.clone());
            }

            // 用户数量应该是 1
            prop_assert_eq!(whitelist.len(), 1);
            // 用户应该被允许
            prop_assert!(whitelist.is_allowed(&user_id));
        }

        /// Property 3.8: 移除不存在的用户不影响白名单
        /// **Validates: Requirement 3.5**
        #[test]
        fn prop_remove_nonexistent_user_no_effect(
            existing_user in arb_user_id(),
            nonexistent_user in arb_user_id()
        ) {
            prop_assume!(existing_user != nonexistent_user);

            let mut whitelist = WhitelistManager::from_users(vec![existing_user.clone()]);
            let len_before = whitelist.len();

            // 移除不存在的用户
            let removed = whitelist.remove_user(&nonexistent_user);

            // 应该返回 false
            prop_assert!(!removed);
            // 长度不变
            prop_assert_eq!(whitelist.len(), len_before);
            // 现有用户仍然被允许
            prop_assert!(whitelist.is_allowed(&existing_user));
        }

        /// Property 3.9: 清空后允许所有用户
        /// **Validates: Requirement 3.2**
        #[test]
        fn prop_clear_allows_all(
            initial_users in prop::collection::vec(arb_user_id(), 1..10),
            test_user in arb_user_id()
        ) {
            let mut whitelist = WhitelistManager::from_users(initial_users);

            // 清空前可能不允许某些用户
            whitelist.clear();

            // 清空后应该允许所有用户
            prop_assert!(whitelist.is_empty());
            prop_assert!(whitelist.is_allowed(&test_user));
        }

        /// Property 3.10: list_users 返回所有白名单用户
        /// **Validates: Requirement 3.1, 3.6**
        #[test]
        fn prop_list_users_complete(users in prop::collection::hash_set(arb_user_id(), 0..20)) {
            let users_vec: Vec<String> = users.iter().cloned().collect();
            let whitelist = WhitelistManager::from_users(users_vec);

            let listed: std::collections::HashSet<&String> = whitelist.list_users().into_iter().collect();

            // 列出的用户数量应该与输入一致
            prop_assert_eq!(listed.len(), users.len());

            // 每个输入用户都应该在列表中
            for user in &users {
                prop_assert!(listed.contains(user));
            }
        }
    }

    // ============================================================================
    // Unit Tests
    // ============================================================================

    /// 测试创建空白名单
    #[test]
    fn test_new_whitelist_is_empty() {
        let whitelist = WhitelistManager::new();
        assert!(whitelist.is_empty());
        assert!(!whitelist.is_enabled());
        assert_eq!(whitelist.len(), 0);
    }

    /// 测试空白名单允许所有用户
    /// **Validates: Requirement 3.2**
    #[test]
    fn test_empty_whitelist_allows_all_users() {
        let whitelist = WhitelistManager::new();
        assert!(whitelist.is_allowed("user1"));
        assert!(whitelist.is_allowed("user2"));
        assert!(whitelist.is_allowed("any_random_user"));
    }

    /// 测试从用户列表创建白名单
    #[test]
    fn test_from_users() {
        let whitelist =
            WhitelistManager::from_users(vec!["user1".to_string(), "user2".to_string()]);
        assert_eq!(whitelist.len(), 2);
        assert!(whitelist.is_enabled());
        assert!(whitelist.is_allowed("user1"));
        assert!(whitelist.is_allowed("user2"));
    }

    /// 测试非空白名单只允许白名单中的用户
    /// **Validates: Requirement 3.3**
    #[test]
    fn test_non_empty_whitelist_restricts_users() {
        let whitelist = WhitelistManager::from_users(vec!["allowed_user".to_string()]);
        assert!(whitelist.is_allowed("allowed_user"));
        assert!(!whitelist.is_allowed("other_user"));
        assert!(!whitelist.is_allowed("random_user"));
    }

    /// 测试添加用户到白名单
    /// **Validates: Requirement 3.4**
    #[test]
    fn test_add_user() {
        let mut whitelist = WhitelistManager::new();

        // 添加前允许所有用户
        assert!(whitelist.is_allowed("user1"));
        assert!(whitelist.is_allowed("user2"));

        // 添加用户后只允许白名单中的用户
        whitelist.add_user("user1".to_string());
        assert!(whitelist.is_allowed("user1"));
        assert!(!whitelist.is_allowed("user2"));

        // 添加更多用户
        whitelist.add_user("user2".to_string());
        assert!(whitelist.is_allowed("user1"));
        assert!(whitelist.is_allowed("user2"));
        assert!(!whitelist.is_allowed("user3"));
    }

    /// 测试从白名单移除用户
    /// **Validates: Requirement 3.5**
    #[test]
    fn test_remove_user() {
        let mut whitelist =
            WhitelistManager::from_users(vec!["user1".to_string(), "user2".to_string()]);

        // 移除存在的用户
        assert!(whitelist.remove_user("user1"));
        assert!(!whitelist.is_allowed("user1"));
        assert!(whitelist.is_allowed("user2"));

        // 移除不存在的用户
        assert!(!whitelist.remove_user("user1"));
        assert!(!whitelist.remove_user("nonexistent"));
    }

    /// 测试移除最后一个用户后允许所有用户
    #[test]
    fn test_remove_last_user_allows_all() {
        let mut whitelist = WhitelistManager::from_users(vec!["user1".to_string()]);

        assert!(!whitelist.is_allowed("other_user"));

        whitelist.remove_user("user1");

        // 白名单为空后允许所有用户
        assert!(whitelist.is_allowed("other_user"));
        assert!(whitelist.is_allowed("any_user"));
    }

    /// 测试检查用户是否在白名单中
    /// **Validates: Requirement 3.6**
    #[test]
    fn test_is_allowed() {
        let whitelist =
            WhitelistManager::from_users(vec!["user1".to_string(), "user2".to_string()]);

        assert!(whitelist.is_allowed("user1"));
        assert!(whitelist.is_allowed("user2"));
        assert!(!whitelist.is_allowed("user3"));
    }

    /// 测试获取白名单用户列表
    #[test]
    fn test_list_users() {
        let whitelist =
            WhitelistManager::from_users(vec!["user1".to_string(), "user2".to_string()]);

        let users = whitelist.list_users();
        assert_eq!(users.len(), 2);
        assert!(users.contains(&&"user1".to_string()));
        assert!(users.contains(&&"user2".to_string()));
    }

    /// 测试清空白名单
    #[test]
    fn test_clear() {
        let mut whitelist =
            WhitelistManager::from_users(vec!["user1".to_string(), "user2".to_string()]);

        assert!(!whitelist.is_allowed("other_user"));

        whitelist.clear();

        assert!(whitelist.is_empty());
        assert!(!whitelist.is_enabled());
        assert!(whitelist.is_allowed("other_user"));
        assert!(whitelist.is_allowed("any_user"));
    }

    /// 测试重复添加用户
    #[test]
    fn test_add_duplicate_user() {
        let mut whitelist = WhitelistManager::new();

        whitelist.add_user("user1".to_string());
        whitelist.add_user("user1".to_string());

        assert_eq!(whitelist.len(), 1);
        assert!(whitelist.is_allowed("user1"));
    }

    /// 测试 Default trait
    #[test]
    fn test_default() {
        let whitelist = WhitelistManager::default();
        assert!(whitelist.is_empty());
        assert!(whitelist.is_allowed("any_user"));
    }

    /// 测试 Clone trait
    #[test]
    fn test_clone() {
        let mut original = WhitelistManager::from_users(vec!["user1".to_string()]);
        let cloned = original.clone();

        // 修改原始不影响克隆
        original.add_user("user2".to_string());

        assert!(original.is_allowed("user2"));
        assert!(!cloned.is_allowed("user2"));
    }
}
