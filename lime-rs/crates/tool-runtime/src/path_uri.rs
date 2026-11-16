//! Host-independent `file:` URI paths for tool execution environments.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::borrow::Cow;
use std::fmt;
use std::io;
use std::path::{Path, PathBuf};
use url::Url;

const FILE_SCHEME: &str = "file";

/// Immutable path identity that can represent a cwd owned by another OS.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct PathUri(Url);

impl PathUri {
    pub fn parse(uri: &str) -> Result<Self, PathUriError> {
        Self::try_from(Url::parse(uri)?)
    }

    /// Converts an absolute path using the current host's path convention.
    pub fn from_host_path(path: impl AsRef<Path>) -> io::Result<Self> {
        let path = path.as_ref();
        if !path.is_absolute() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("path '{}' must be absolute", path.display()),
            ));
        }
        let url = Url::from_file_path(path).map_err(|()| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "path '{}' cannot be represented as a file URI",
                    path.display()
                ),
            )
        })?;
        Self::try_from(url).map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))
    }

    /// Resolves a host-relative path before converting it to a URI.
    pub fn from_host_path_resolved(path: impl AsRef<Path>) -> io::Result<Self> {
        let path = path.as_ref();
        if path.is_absolute() {
            return Self::from_host_path(path);
        }
        Self::from_host_path(std::path::absolute(path)?)
    }

    pub fn infer_path_convention(&self) -> PathConvention {
        if self.0.host_str().is_some() || self.has_windows_drive() {
            PathConvention::Windows
        } else {
            PathConvention::Posix
        }
    }

    /// Renders using the convention encoded by the URI, independent of this host.
    pub fn inferred_native_path_string(&self) -> String {
        match self.infer_path_convention() {
            PathConvention::Posix => render_posix(&self.0),
            PathConvention::Windows => render_windows(&self.0),
        }
    }

    /// Converts to a native path only when the URI belongs to this host convention.
    pub fn to_host_path(&self) -> io::Result<PathBuf> {
        if self.infer_path_convention() != PathConvention::native() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("foreign path URI cannot execute on this host: {self}"),
            ));
        }
        self.0.to_file_path().map_err(|()| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("path URI cannot be converted on this host: {self}"),
            )
        })
    }

    /// Resolves native path text lexically using this URI's path convention.
    pub fn join(&self, path: &str) -> Result<Self, PathUriError> {
        if path.contains('\0') {
            return Err(PathUriError::InvalidPath(path.to_string()));
        }
        if path.is_empty() {
            return Ok(self.clone());
        }

        let convention = self.infer_path_convention();
        if let Some(absolute) = parse_absolute_native_path(path, convention) {
            return Ok(absolute);
        }
        if convention == PathConvention::Windows
            && matches!(path.as_bytes(), [drive, b':', ..] if drive.is_ascii_alphabetic())
        {
            return Err(PathUriError::InvalidPath(path.to_string()));
        }

        let mut url = self.0.clone();
        let anchor_depth = usize::from(convention == PathConvention::Windows);
        let mut depth = url
            .path_segments()
            .map(|segments| segments.filter(|segment| !segment.is_empty()).count())
            .unwrap_or_default();
        let windows_root_relative = convention == PathConvention::Windows
            && matches!(path.as_bytes(), [b'\\' | b'/', rest @ ..] if !matches!(rest, [b'\\' | b'/', ..]));
        {
            let mut segments = url
                .path_segments_mut()
                .map_err(|()| PathUriError::InvalidPath(self.to_string()))?;
            segments.pop_if_empty();
            if windows_root_relative {
                while depth > anchor_depth {
                    segments.pop();
                    depth -= 1;
                }
            }
            let path = match convention {
                PathConvention::Posix => Cow::Borrowed(path),
                PathConvention::Windows => Cow::Owned(path.replace('\\', "/")),
            };
            for component in path.split('/') {
                match component {
                    "" | "." => {}
                    ".." if depth > anchor_depth => {
                        segments.pop();
                        depth -= 1;
                    }
                    ".." => {}
                    component => {
                        segments.push(component);
                        depth += 1;
                    }
                }
            }
        }
        Self::try_from(url)
    }

    pub fn starts_with(&self, base: &Self) -> bool {
        if self.0.host_str() != base.0.host_str() {
            return false;
        }
        let Some(path) = containment_segments(&self.0, self.infer_path_convention()) else {
            return false;
        };
        let Some(base) = containment_segments(&base.0, base.infer_path_convention()) else {
            return false;
        };
        path.starts_with(&base)
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }

    /// Transitional helper for callers that previously projected a `PathBuf`.
    pub fn to_string_lossy(&self) -> Cow<'_, str> {
        Cow::Owned(self.inferred_native_path_string())
    }

    fn has_windows_drive(&self) -> bool {
        self.0
            .path_segments()
            .and_then(|mut segments| segments.find(|segment| !segment.is_empty()))
            .is_some_and(|segment| {
                matches!(segment.as_bytes(), [drive, b':'] if drive.is_ascii_alphabetic())
            })
    }
}

impl TryFrom<Url> for PathUri {
    type Error = PathUriError;

    fn try_from(mut url: Url) -> Result<Self, Self::Error> {
        if url.scheme() != FILE_SCHEME {
            return Err(PathUriError::UnsupportedScheme(url.scheme().to_string()));
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err(PathUriError::CredentialsNotAllowed);
        }
        if url.port().is_some() {
            return Err(PathUriError::PortNotAllowed);
        }
        if url.query().is_some() {
            return Err(PathUriError::QueryNotAllowed);
        }
        if url.fragment().is_some() {
            return Err(PathUriError::FragmentNotAllowed);
        }
        if urlencoding::decode_binary(url.path().as_bytes()).contains(&0) {
            return Err(PathUriError::InvalidPath(url.to_string()));
        }
        if url.host_str() == Some("localhost") {
            url.set_host(None)
                .map_err(|_| PathUriError::InvalidPath(url.to_string()))?;
        }
        Ok(Self(url))
    }
}

impl<'de> Deserialize<'de> for PathUri {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::parse(&String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

impl Serialize for PathUri {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl fmt::Display for PathUri {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl PartialEq<PathBuf> for PathUri {
    fn eq(&self, other: &PathBuf) -> bool {
        let resolved = other
            .is_relative()
            .then(|| std::path::absolute(other).ok())
            .flatten();
        self.to_host_path()
            .is_ok_and(|path| path == *other || resolved.as_ref() == Some(&path))
            || self.inferred_native_path_string() == other.to_string_lossy()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PathConvention {
    Posix,
    Windows,
}

impl PathConvention {
    #[cfg(unix)]
    pub const fn native() -> Self {
        Self::Posix
    }

    #[cfg(windows)]
    pub const fn native() -> Self {
        Self::Windows
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum PathUriError {
    InvalidUri(url::ParseError),
    UnsupportedScheme(String),
    InvalidPath(String),
    CredentialsNotAllowed,
    PortNotAllowed,
    QueryNotAllowed,
    FragmentNotAllowed,
}

impl From<url::ParseError> for PathUriError {
    fn from(error: url::ParseError) -> Self {
        Self::InvalidUri(error)
    }
}

impl fmt::Display for PathUriError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidUri(error) => write!(formatter, "invalid URI: {error}"),
            Self::UnsupportedScheme(scheme) => {
                write!(formatter, "unsupported path URI scheme `{scheme}`")
            }
            Self::InvalidPath(path) => write!(formatter, "invalid path URI `{path}`"),
            Self::CredentialsNotAllowed => {
                formatter.write_str("credentials are not allowed in path URIs")
            }
            Self::PortNotAllowed => formatter.write_str("ports are not allowed in path URIs"),
            Self::QueryNotAllowed => {
                formatter.write_str("query parameters are not allowed in path URIs")
            }
            Self::FragmentNotAllowed => {
                formatter.write_str("fragments are not allowed in path URIs")
            }
        }
    }
}

impl std::error::Error for PathUriError {}

fn parse_absolute_native_path(path: &str, convention: PathConvention) -> Option<PathUri> {
    match convention {
        PathConvention::Posix => path.starts_with('/').then_some(path).and_then(|path| {
            let mut url = Url::parse("file:///").ok()?;
            url.path_segments_mut()
                .ok()?
                .clear()
                .extend(path.split('/').filter(|segment| !segment.is_empty()));
            PathUri::try_from(url).ok()
        }),
        PathConvention::Windows => parse_absolute_windows_path(path),
    }
}

fn parse_absolute_windows_path(path: &str) -> Option<PathUri> {
    let bytes = path.as_bytes();
    if matches!(bytes, [drive, b':', separator, ..]
        if drive.is_ascii_alphabetic() && matches!(separator, b'\\' | b'/'))
    {
        let mut url = Url::parse("file:///").ok()?;
        url.path_segments_mut().ok()?.clear().extend(
            std::iter::once(&path[..2]).chain(
                path[3..]
                    .split(['\\', '/'])
                    .filter(|segment| !segment.is_empty()),
            ),
        );
        return PathUri::try_from(url).ok();
    }
    if matches!(bytes, [b'\\' | b'/', b'\\' | b'/', ..]) {
        let mut components = path[2..]
            .split(['\\', '/'])
            .filter(|segment| !segment.is_empty());
        let host = components.next()?;
        let share = components.next()?;
        let mut url = Url::parse("file:///").ok()?;
        url.set_host(Some(host)).ok()?;
        url.path_segments_mut()
            .ok()?
            .clear()
            .extend(std::iter::once(share).chain(components));
        return PathUri::try_from(url).ok();
    }
    None
}

fn containment_segments(url: &Url, convention: PathConvention) -> Option<Vec<&str>> {
    let segments = url
        .path_segments()?
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    (!segments.iter().any(|segment| {
        urlencoding::decode_binary(segment.as_bytes())
            .iter()
            .any(|byte| *byte == b'/' || (convention == PathConvention::Windows && *byte == b'\\'))
    }))
    .then_some(segments)
}

fn render_posix(url: &Url) -> String {
    let mut rendered = String::new();
    for segment in url
        .path_segments()
        .into_iter()
        .flatten()
        .filter(|segment| !segment.is_empty())
    {
        rendered.push('/');
        rendered.push_str(&decode_segment(segment));
    }
    if rendered.is_empty() {
        rendered.push('/');
    }
    rendered
}

fn render_windows(url: &Url) -> String {
    let mut segments = url
        .path_segments()
        .into_iter()
        .flatten()
        .filter(|segment| !segment.is_empty());
    let mut rendered = if let Some(host) = url.host_str() {
        let share = segments.next().unwrap_or_default();
        format!(r"\\{}\{}", host, decode_segment(share))
    } else {
        decode_segment(segments.next().unwrap_or_default())
    };
    for segment in segments {
        rendered.push('\\');
        rendered.push_str(&decode_segment(segment));
    }
    if rendered.len() == 2 && rendered.ends_with(':') {
        rendered.push('\\');
    }
    rendered
}

fn decode_segment(segment: &str) -> String {
    String::from_utf8_lossy(&urlencoding::decode_binary(segment.as_bytes())).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn foreign_windows_path_remains_host_independent() {
        let cwd = PathUri::parse("file:///C:/plugins/demo").expect("foreign path URI");

        assert_eq!(cwd.infer_path_convention(), PathConvention::Windows);
        assert_eq!(cwd.inferred_native_path_string(), r"C:\plugins\demo");
        #[cfg(unix)]
        assert!(cwd.to_host_path().is_err());
    }

    #[test]
    fn foreign_join_and_containment_are_lexical() {
        let root = PathUri::parse("file:///C:/plugins/demo").expect("plugin root URI");
        let child = root.join(r"servers\docs").expect("joined cwd URI");

        assert_eq!(child.to_string(), "file:///C:/plugins/demo/servers/docs");
        assert!(child.starts_with(&root));
        assert!(
            !root
                .join(r"..\outside")
                .expect("bounded URI")
                .starts_with(&root)
        );
    }

    #[test]
    fn foreign_unc_path_retains_authority_and_share_root() {
        let root = PathUri::parse("file://server/share/plugins").expect("UNC path URI");
        let child = root.join(r"docs\index.md").expect("joined UNC path URI");

        assert_eq!(
            root.inferred_native_path_string(),
            r"\\server\share\plugins"
        );
        assert_eq!(
            child.to_string(),
            "file://server/share/plugins/docs/index.md"
        );
        assert!(child.starts_with(&root));
    }

    #[test]
    fn encoded_native_separators_fail_closed_for_containment() {
        let root = PathUri::parse("file:///C:/workspace").expect("workspace URI");
        let encoded =
            PathUri::parse("file:///C:/workspace%5Coutside/file.txt").expect("encoded path URI");

        assert!(!encoded.starts_with(&root));
    }

    #[test]
    fn rejects_non_file_and_ambiguous_metadata() {
        assert!(matches!(
            PathUri::parse("https://example.com/path"),
            Err(PathUriError::UnsupportedScheme(_))
        ));
        assert!(matches!(
            PathUri::parse("file:///tmp/work?query=yes"),
            Err(PathUriError::QueryNotAllowed)
        ));
    }

    #[test]
    fn serde_uses_canonical_uri_string() {
        let cwd = PathUri::parse("file://localhost/tmp/work%20tree").expect("path URI");
        let serialized = serde_json::to_string(&cwd).expect("serialize path URI");
        let restored: PathUri = serde_json::from_str(&serialized).expect("restore path URI");

        assert_eq!(serialized, r#""file:///tmp/work%20tree""#);
        assert_eq!(restored, cwd);
    }
}
