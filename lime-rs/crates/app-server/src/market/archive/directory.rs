use super::*;

/// Verify an installed tree before loading its declared entry. Links and extra
/// files are rejected just as they are at the ZIP boundary.
pub(crate) fn verify_directory(root: &Path, release: &Release) -> Result<(), String> {
    release.validate().map_err(|e| e.to_string())?;
    let expected = release
        .manifest
        .files
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect::<BTreeMap<_, _>>();
    let mut remaining = expected;
    visit(root, root, &mut remaining)?;
    if !remaining.is_empty() {
        return Err(invalid());
    }
    Ok(())
}

fn visit<'a>(
    root: &Path,
    path: &Path,
    remaining: &mut BTreeMap<&'a str, &'a wire::File>,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| invalid())?;
    if metadata.file_type().is_symlink() {
        return Err(invalid());
    }
    if metadata.is_dir() {
        let relative = path.strip_prefix(root).map_err(|_| invalid())?;
        if !relative.as_os_str().is_empty() {
            let prefix = format!("{}/", relative.to_string_lossy().replace('\\', "/"));
            if !remaining.keys().any(|name| name.starts_with(&prefix)) {
                return Err(invalid());
            }
        }
        for entry in fs::read_dir(path).map_err(|_| invalid())? {
            visit(root, &entry.map_err(|_| invalid())?.path(), remaining)?;
        }
        return Ok(());
    }
    let relative = path
        .strip_prefix(root)
        .map_err(|_| invalid())?
        .to_str()
        .ok_or_else(invalid)?
        .replace('\\', "/");
    let expected = remaining.remove(relative.as_str()).ok_or_else(invalid)?;
    if !metadata.is_file() || metadata.len() != expected.size {
        return Err(invalid());
    }
    let mut file = fs::File::open(path).map_err(|_| invalid())?;
    let mut digest = Sha256::new();
    let mut total = 0u64;
    let mut block = [0; 8192];
    loop {
        let read = Read::by_ref(&mut file)
            .take(expected.size.saturating_sub(total) + 1)
            .read(&mut block)
            .map_err(|_| invalid())?;
        if read == 0 {
            break;
        }
        total += read as u64;
        if total > expected.size {
            return Err(invalid());
        }
        digest.update(&block[..read]);
    }
    if total != expected.size || hex::encode(digest.finalize()) != expected.sha256 {
        return Err(invalid());
    }
    Ok(())
}

#[cfg(test)]
mod tests;
