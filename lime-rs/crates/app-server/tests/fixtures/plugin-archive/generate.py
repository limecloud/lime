"""Generate the byte-identical Lime/LimeCore tar.gz contract corpus (stdlib only)."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path


def header(name, kind=b"0", size=0):
    block = bytearray(512)
    encoded = name.encode()
    if len(encoded) > 100:
        raise ValueError("use PAX or GNU metadata for long paths")
    block[: len(encoded)] = encoded
    for start, width, value in [(100, 8, 0o755), (108, 8, 0), (116, 8, 0),
                                (124, 12, size), (136, 12, 0)]:
        block[start : start + width] = f"{value:0{width - 1}o}\0".encode()
    block[148:156] = b"        "
    block[156:157] = kind
    block[257:265] = b"ustar\x0000"
    block[148:156] = f"{sum(block):06o}\0 ".encode()
    return bytes(block)


def entry(name, content=b"", kind=b"0", declared=None):
    return header(name, kind, len(content) if declared is None else declared) + content + bytes(-len(content) % 512)


def pax_record(key, value):
    body = f" {key}={value}\n".encode()
    length = len(body) + 1
    while len(str(length)) + len(body) != length:
        length = len(str(length)) + len(body)
    return str(length).encode() + body


def pax_path(name, content=b"long"):
    return entry("PaxHeader", pax_record("path", name), b"x") + entry("fallback", content)


def native(size=None):
    data = b'{"name":"example","description":""}'
    if size is not None:
        data = data[:-2] + b"x" * (size - len(data)) + data[-2:]
    return data


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mirror", type=Path)
    args = parser.parse_args()
    outputs = [Path(__file__).resolve().parent]
    if args.mirror:
        outputs.append(args.mirror)
    for output in outputs:
        output.mkdir(parents=True, exist_ok=True)
    cases = []

    def add(case_id, raw, accepted=True, *, limit=None, manifest=None, manifest_ok=None, files=None, packed=False):
        data = raw if packed else gzip.compress(raw, mtime=0)
        if not packed:
            data = data[:9] + b"\xff" + data[10:]
        case = {"id": case_id, "file": case_id + ".tar.gz", "sha256": digest(data), "archiveAccepted": accepted}
        if limit is not None:
            case["expandedLimit"] = limit
        if manifest_ok is not None:
            case["manifestAccepted"] = manifest_ok
        if manifest:
            case["manifestPath"], content = manifest
            case["manifestHash"] = digest(content)
        if files:
            case["files"] = {name: digest(content) for name, content in files.items()}
        for output in outputs:
            (output / case["file"]).write_bytes(data)
        cases.append(case)

    end = bytes(1024)
    path = ".lime-plugin/plugin.json"
    base = entry(path, native())
    standard = b'{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json","name":"example"}'
    add("native-root-dotfiles", entry("./", kind=b"5") + base + entry(".hidden", b"hidden") + end,
        manifest=(path, native()), manifest_ok=True, files={".hidden": b"hidden"})
    add("standard-priority", base + entry("plugin.json", standard) + end,
        manifest=("plugin.json", standard), manifest_ok=True)
    add("unrelated-root", entry("plugin.json", b'{"name":"unrelated"}') + base + end,
        manifest=(path, native()), manifest_ok=True)
    add("native-priority", entry(".cursor-plugin/plugin.json", b'{"name":"cursor"}') +
        entry(".claude-plugin/plugin.json", b'{"name":"claude"}') + base + end,
        manifest=(path, native()), manifest_ok=True)
    add("cursor-fallback", entry(".cursor-plugin/plugin.json", native()) + end,
        manifest=(".cursor-plugin/plugin.json", native()), manifest_ok=True)
    add("unsupported-standard", base + entry("plugin.json", standard.replace(b"1.0.0", b"2.0.0")) + end,
        manifest_ok=False)
    add("invalid-selected-manifest", entry(path, b'{"name":42}') + end, manifest_ok=False)
    add("manifest-limit", entry(path, native(2 * 1024 * 1024)) + end,
        manifest=(path, native(2 * 1024 * 1024)), manifest_ok=True)
    add("manifest-over-limit", entry(path, native(2 * 1024 * 1024 + 1)) + end, manifest_ok=False)
    add("unused-manifest-over-limit", base + entry(".cursor-plugin/plugin.json", native(2 * 1024 * 1024 + 1)) + end,
        manifest=(path, native()), manifest_ok=True)
    add("root-over-limit-no-fallback", base + entry("plugin.json", native(2 * 1024 * 1024 + 1)) + end,
        manifest_ok=False)
    long_path = "/".join(["segment"] * 35) + "/file"
    add("pax-long-name", base + pax_path(long_path) + end, files={long_path: b"long"})
    add("gnu-long-name", base + entry("././@LongLink", long_path.encode() + b"\0", b"L") + entry("fallback", b"long") + end,
        files={long_path: b"long"})
    add("pax-size", entry("PaxHeader", pax_record("size", "3"), b"x") + entry("file", b"123", declared=0) + end,
        files={"file": b"123"})
    for case_id, name in [("parent", "../escape"), ("internal-parent", "a/../escape"), ("absolute", "/escape"),
                          ("drive", "C:/escape"), ("backslash", "a\\file"), ("leading-space", " file"),
                          ("trailing-space", "file "), ("empty-file", "./")]:
        add(case_id, entry(name) + end, False)
    for case_id, name in [("pax-parent", "../escape"), ("pax-nul", "file\0hidden")]:
        add(case_id, pax_path(name) + end, False)
    add("gnu-parent", entry("././@LongLink", b"../escape\0", b"L") + entry("file") + end, False)
    for case_id, kind in [("symlink", b"2"), ("hardlink", b"1"), ("fifo", b"6"), ("character", b"3"),
                          ("block", b"4"), ("gnu-sparse", b"S")]:
        add(case_id, entry("unsafe", kind=kind) + end, False)
    sparse = pax_record("GNU.sparse.map", "0,1") + pax_record("GNU.sparse.size", "1")
    add("pax-sparse", entry("PaxHeader", sparse, b"x") + entry("file", b"x") + end, False)
    add("directory-body", entry("dir", b"x", b"5") + end, False)
    add("root-directory-body", entry("./", b"x", b"5") + end, False)
    add("duplicate", entry("same") + entry("./same") + end, False)
    add("normalized-duplicate", entry("a/file") + entry("a//./file") + end, False)
    add("file-parent-first", entry("parent") + entry("parent/child") + end, False)
    add("file-parent-last", entry("parent/child") + entry("parent") + end, False)
    add("file-directory-conflict", entry("same", kind=b"5") + entry("same") + end, False)
    add("nonzero-tail", base + end + b"bad", False)
    add("truncated-file", header("file", size=100) + b"x", False)
    add("truncated-header", header("file")[:100], False)
    corrupt = bytearray(header("file"))
    corrupt[0] ^= 1
    add("bad-tar-checksum", bytes(corrupt) + end, False)
    valid = gzip.compress(base + end, mtime=0)
    corrupt = bytearray(valid)
    corrupt[-8] ^= 1
    add("bad-gzip-crc", bytes(corrupt), False, packed=True)
    add("truncated-gzip", valid[:-3], False, packed=True)
    add("multiple-gzip-streams", valid + valid, False, packed=True)
    add("compressed-junk", valid + b"junk", False, packed=True)
    add("zip-rejected", b"PK\x03\x04", False, packed=True)
    add("expanded-limit", entry("file", b"1234") + end, limit=4, files={"file": b"1234"})
    add("expanded-over-limit", entry("file", b"12345") + end, False, limit=4)
    add("padding-limit", bytes(32 * 1024 * 1024), limit=0)
    add("padding-over-limit", bytes(32 * 1024 * 1024 + 1), False, limit=0)
    entries = b"".join(entry(f"file-{i:05}") for i in range(10_000))
    add("entry-limit", entries + end)
    add("entry-over-limit", entries + entry("overflow") + end, False)
    add("depth-limit", pax_path("/".join(["a"] * 256), b"") + end)
    add("depth-over-limit", pax_path("/".join(["a"] * 257), b"") + end, False)
    manifests = [
        ("root", "plugin.json"),
        ("lime", ".lime-plugin/plugin.json"),
        ("claude", ".claude-plugin/plugin.json"),
        ("cursor", ".cursor-plugin/plugin.json"),
    ]
    for index, (name, manifest_path) in enumerate(manifests):
        fallback = entry(manifests[index + 1][1], native()) if index + 1 < len(manifests) else b""
        for kind, directory in [
            ("directory", entry(manifest_path + "/", kind=b"5")),
            ("implicit-file", entry(manifest_path + "/nested/child", b"non-manifest file")),
            ("implicit-directory", entry(manifest_path + "/nested/child/", kind=b"5")),
        ]:
            add(f"manifest-{name}-{kind}", directory + fallback + end, manifest_ok=False)
        if index > 0:
            add(f"manifest-{name}-parent-file",
                entry(manifest_path.split("/")[0], b"non-manifest file") + fallback + end,
                manifest_ok=False)
        content = standard if index == 0 else native()
        add(f"manifest-valid-{name}", entry(manifest_path, content) + end,
            manifest=(manifest_path, content), manifest_ok=True)
    index = json.dumps({"schemaVersion": 1, "cases": cases}, indent=2) + "\n"
    for output in outputs:
        (output / "index.json").write_text(index)
    print(f"Generated {len(cases)} byte-identical cases in {len(outputs)} repositories")


if __name__ == "__main__":
    main()
