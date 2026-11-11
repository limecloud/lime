//! 将已认证的归档换为一次性接收方；本机不落地明文，原私钥不离开本机。
use super::*;
use std::io::BufReader;

pub(super) const MAX_LOCAL_CIPHERTEXT_BYTES: u64 = MAX_ARCHIVE_BYTES + 1024 * 1024 * 1024;

fn open_regular(path: &Path, max_bytes: u64) -> Result<File, String> {
    if !path.is_absolute() || !fs::symlink_metadata(path).is_ok_and(|meta| meta.is_file()) {
        return Err("Expected an absolute regular file".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options
        .open(path)
        .map_err(|_| "Cannot open recovery input")?;
    let meta = file
        .metadata()
        .map_err(|_| "Cannot inspect recovery input")?;
    if !meta.is_file() || meta.len() > max_bytes {
        return Err("Invalid recovery file or size limit exceeded".into());
    }
    Ok(file)
}

pub(super) fn read_identity(path: &Path) -> Result<age::x25519::Identity, String> {
    let file = open_regular(path, 16384)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = file
            .metadata()
            .map_err(|_| "Cannot inspect recovery identity")?;
        if metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o077 != 0
            || metadata.nlink() != 1
        {
            return Err("Recovery identity file must be private".into());
        }
    }
    let mut text = String::new();
    if file
        .take(16385)
        .read_to_string(&mut text)
        .map_err(|_| "Cannot read local recovery identity")?
        > 16384
    {
        return Err("Recovery identity file is too large".into());
    }
    let mut lines = text
        .lines()
        .filter(|line| !line.trim().is_empty() && !line.starts_with('#'));
    let key = lines
        .next()
        .filter(|_| lines.next().is_none())
        .ok_or("Expected one local age X25519 identity")?;
    age::x25519::Identity::from_str(key).map_err(|_| "Invalid recovery identity".into())
}

pub(super) struct CiphertextReader {
    input: File,
    hash: Sha256,
    remaining: u64,
}
impl Read for CiphertextReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let count = self.input.read(buffer)?;
        self.remaining = self
            .remaining
            .checked_sub(count as u64)
            .ok_or_else(|| io::Error::other("Encrypted archive exceeds the size limit"))?;
        self.hash.update(&buffer[..count]);
        Ok(count)
    }
}

pub(super) fn ciphertext_reader(
    path: &Path,
    limit: u64,
) -> Result<BufReader<CiphertextReader>, String> {
    Ok(BufReader::new(CiphertextReader {
        input: open_regular(path, limit)?,
        hash: Sha256::new(),
        remaining: limit,
    }))
}

pub(super) fn verify_read(
    mut reader: BufReader<CiphertextReader>,
    expected: &str,
) -> Result<(), String> {
    // The decryptor must consume the complete stream, including age's last chunk.
    if reader
        .read(&mut [0])
        .map_err(|_| "Cannot verify encrypted archive")?
        != 0
        || !format!("{:x}", reader.into_inner().hash.finalize()).eq_ignore_ascii_case(expected)
    {
        return Err("Archive digest does not match the trusted export receipt".into());
    }
    Ok(())
}

pub fn rewrap_for_restore(
    archive: &Path,
    identity: &Path,
    output: &Path,
    expected: &str,
    recipient: &str,
) -> Result<Value, String> {
    if !output.is_absolute() || output.extension().is_none_or(|ext| ext != "age") {
        return Err("Rewrapping requires a new absolute .age file".into());
    }
    let mut source = ciphertext_reader(archive, MAX_CLOUD_CIPHERTEXT_BYTES)?;
    let identity = read_identity(identity)?;
    let recipient = age::x25519::Recipient::from_str(recipient)
        .map_err(|_| "Invalid temporary age public recipient")?;
    let mut output_file =
        tempfile::NamedTempFile::new_in(output.parent().ok_or("Missing output parent")?)
            .map_err(|_| "Cannot stage encrypted restore")?;
    lime_infra::secure_file::ensure_owner_only_permissions(output_file.path())
        .map_err(|_| "Cannot protect encrypted restore")?;
    let decryptor = Decryptor::new(&mut source).map_err(|_| "Invalid encrypted archive")?;
    let mut clear = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|_| "Cannot decrypt archive with the selected identity")?;
    let encryptor = Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))
        .map_err(|_| "Cannot initialize temporary archive encryption")?;
    let mut encrypted = encryptor
        .wrap_output(output_file.as_file_mut())
        .map_err(|_| "Cannot encrypt restore stream")?;
    io::copy(&mut clear, &mut encrypted)
        .map_err(|_| "Cannot authenticate and re-encrypt restore stream")?;
    drop(clear);
    verify_read(source, expected)?;
    encrypted
        .finish()
        .map_err(|_| "Cannot finalize encrypted restore")?;
    output_file
        .as_file()
        .sync_all()
        .map_err(|_| "Cannot sync encrypted restore")?;
    let (sha256, bytes) = digest(output_file.path())?;
    if bytes > MAX_CLOUD_CIPHERTEXT_BYTES {
        return Err("Encrypted restore exceeds the size limit".into());
    }
    output_file
        .persist_noclobber(output)
        .map_err(|_| "Cannot publish encrypted restore staging file")?;
    Ok(json!({ "sha256": sha256, "bytes": bytes }))
}

pub struct CloudRestoreIdentity(age::x25519::Identity);
impl CloudRestoreIdentity {
    pub fn generate() -> Self {
        Self(age::x25519::Identity::generate())
    }

    pub fn recipient(&self) -> String {
        self.0.to_public().to_string()
    }

    pub fn restore(
        self,
        archive: &Path,
        destination: &Path,
        expected_sha256: &str,
    ) -> Result<Value, String> {
        // The file limit excludes the small Lime manifest and bounded tar framing.
        restore_with_identity(
            archive,
            &self.0,
            destination,
            expected_sha256,
            MAX_DOWNLOAD_SOURCE_BYTES + 65536,
            MAX_CLOUD_CIPHERTEXT_BYTES,
        )
    }
}
