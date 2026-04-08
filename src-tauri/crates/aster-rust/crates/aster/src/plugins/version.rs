//! 版本检查工具
//!
//! 提供 semver 版本比较和范围检查功能

use std::cmp::Ordering;

/// 解析后的版本号
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl Version {
    /// 解析版本字符串
    pub fn parse(version: &str) -> Option<Self> {
        let parts: Vec<&str> = version.split('.').collect();
        if parts.len() < 3 {
            return None;
        }

        Some(Self {
            major: parts[0].parse().ok()?,
            minor: parts[1].parse().ok()?,
            patch: parts[2].split('-').next()?.parse().ok()?,
        })
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> Ordering {
        match self.major.cmp(&other.major) {
            Ordering::Equal => match self.minor.cmp(&other.minor) {
                Ordering::Equal => self.patch.cmp(&other.patch),
                ord => ord,
            },
            ord => ord,
        }
    }
}

/// 版本检查器
pub struct VersionChecker;

impl VersionChecker {
    /// 检查版本是否满足范围要求
    /// 支持: ^1.0.0, ~1.0.0, >=1.0.0, >1.0.0, <=1.0.0, <1.0.0, 1.0.0, *
    pub fn satisfies(version: &str, range: &str) -> bool {
        if range == "*" || range == "latest" {
            return true;
        }

        let v = match Version::parse(version) {
            Some(v) => v,
            None => return false,
        };

        // ^1.0.0 - 兼容主版本
        if let Some(range_ver) = range.strip_prefix('^') {
            if let Some(r) = Version::parse(range_ver) {
                return v.major == r.major && v >= r;
            }
            return false;
        }

        // ~1.0.0 - 兼容次版本
        if let Some(range_ver) = range.strip_prefix('~') {
            if let Some(r) = Version::parse(range_ver) {
                return v.major == r.major && v.minor == r.minor && v.patch >= r.patch;
            }
            return false;
        }

        // >=1.0.0
        if let Some(range_ver) = range.strip_prefix(">=") {
            if let Some(r) = Version::parse(range_ver) {
                return v >= r;
            }
            return false;
        }

        // >1.0.0
        if let Some(range_ver) = range.strip_prefix('>') {
            if let Some(r) = Version::parse(range_ver) {
                return v > r;
            }
            return false;
        }

        // <=1.0.0
        if let Some(range_ver) = range.strip_prefix("<=") {
            if let Some(r) = Version::parse(range_ver) {
                return v <= r;
            }
            return false;
        }

        // <1.0.0
        if let Some(range_ver) = range.strip_prefix('<') {
            if let Some(r) = Version::parse(range_ver) {
                return v < r;
            }
            return false;
        }

        // 精确匹配
        version == range
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_parse() {
        let v = Version::parse("1.2.3").unwrap();
        assert_eq!(v.major, 1);
        assert_eq!(v.minor, 2);
        assert_eq!(v.patch, 3);
    }

    #[test]
    fn test_version_parse_with_prerelease() {
        let v = Version::parse("1.2.3-beta.1").unwrap();
        assert_eq!(v.major, 1);
        assert_eq!(v.minor, 2);
        assert_eq!(v.patch, 3);
    }

    #[test]
    fn test_version_parse_invalid() {
        assert!(Version::parse("1.2").is_none());
        assert!(Version::parse("invalid").is_none());
        assert!(Version::parse("").is_none());
    }

    #[test]
    fn test_version_ordering() {
        let v1 = Version::parse("1.0.0").unwrap();
        let v2 = Version::parse("1.0.1").unwrap();
        let v3 = Version::parse("1.1.0").unwrap();
        let v4 = Version::parse("2.0.0").unwrap();

        assert!(v1 < v2);
        assert!(v2 < v3);
        assert!(v3 < v4);
        assert!(v1 == Version::parse("1.0.0").unwrap());
    }

    #[test]
    fn test_caret_range() {
        assert!(VersionChecker::satisfies("1.2.3", "^1.0.0"));
        assert!(VersionChecker::satisfies("1.9.9", "^1.0.0"));
        assert!(!VersionChecker::satisfies("2.0.0", "^1.0.0"));
        assert!(!VersionChecker::satisfies("0.9.9", "^1.0.0"));
    }

    #[test]
    fn test_tilde_range() {
        assert!(VersionChecker::satisfies("1.2.3", "~1.2.0"));
        assert!(VersionChecker::satisfies("1.2.9", "~1.2.0"));
        assert!(!VersionChecker::satisfies("1.3.0", "~1.2.0"));
        assert!(!VersionChecker::satisfies("1.1.9", "~1.2.0"));
    }

    #[test]
    fn test_comparison_ranges() {
        // >=
        assert!(VersionChecker::satisfies("1.0.0", ">=1.0.0"));
        assert!(VersionChecker::satisfies("2.0.0", ">=1.0.0"));
        assert!(!VersionChecker::satisfies("0.9.9", ">=1.0.0"));

        // >
        assert!(VersionChecker::satisfies("1.0.1", ">1.0.0"));
        assert!(!VersionChecker::satisfies("1.0.0", ">1.0.0"));

        // <=
        assert!(VersionChecker::satisfies("1.0.0", "<=1.0.0"));
        assert!(VersionChecker::satisfies("0.9.9", "<=1.0.0"));
        assert!(!VersionChecker::satisfies("1.0.1", "<=1.0.0"));

        // <
        assert!(VersionChecker::satisfies("0.9.9", "<1.0.0"));
        assert!(!VersionChecker::satisfies("1.0.0", "<1.0.0"));
    }

    #[test]
    fn test_wildcard_range() {
        assert!(VersionChecker::satisfies("1.0.0", "*"));
        assert!(VersionChecker::satisfies("99.99.99", "*"));
        assert!(VersionChecker::satisfies("0.0.1", "latest"));
    }

    #[test]
    fn test_exact_match() {
        assert!(VersionChecker::satisfies("1.2.3", "1.2.3"));
        assert!(!VersionChecker::satisfies("1.2.4", "1.2.3"));
    }
}
