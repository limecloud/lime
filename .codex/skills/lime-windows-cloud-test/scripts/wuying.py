#!/usr/bin/env python3
"""Use the saved Lime test desktop; credentials remain in official CLI/Keychain stores."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import time
import uuid
import zipfile

STATE = Path(os.environ.get('LIME_WUYING_STATE_DIR', Path.home() / '.local/share/lime-cloud-test')).expanduser()
ACCOUNT = STATE / 'account.json'
ACTIVE = STATE / 'active-desktop.json'
DEFAULT_CLI = STATE / 'tools/aliyun'


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def api(action, params=None):
    account = json.loads(ACCOUNT.read_text(encoding='utf-8'))
    cli = os.environ.get('LIME_WUYING_CLI') or account.get('cli_path') or shutil.which('aliyun') or str(DEFAULT_CLI)
    args = [cli, 'ecd', action, '--profile', account['cli_profile'],
            '--version', '2020-09-30', '--force', '--RegionId', account['region_id']]
    for key, value in (params or {}).items():
        args += ['--' + key, str(value).lower() if isinstance(value, bool) else str(value)]
    result = subprocess.run(args, capture_output=True, text=True, timeout=50)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'Aliyun CLI failed')
    return json.loads(result.stdout)


def describe(desktop_id):
    account = json.loads(ACCOUNT.read_text(encoding='utf-8'))
    values = api('DescribeDesktops', {'DesktopId.1': desktop_id}).get('Desktops', [])
    if len(values) != 1 or values[0]['DesktopId'] != desktop_id:
        raise RuntimeError('Saved desktop does not exist; do not reuse historical IDs')
    desktop = values[0]
    if desktop.get('OfficeSiteId') != account['office_site_id'] or account['end_user_id'] not in desktop.get('EndUserIds', []):
        raise RuntimeError('Desktop account/network mismatch')
    if desktop.get('ChargeType') != 'PostPaid':
        raise RuntimeError('This helper is limited to the authorized pay-as-you-go test desktop')
    return desktop


def current(require_running=False):
    state = json.loads(ACTIVE.read_text(encoding='utf-8'))
    try:
        desktop = describe(state['desktop_id'])
    except RuntimeError as error:
        if 'request to ' not in str(error):
            raise
        desktop = describe(state['desktop_id'])
    if require_running and desktop['DesktopStatus'] != 'Running':
        raise RuntimeError('Desktop is not running')
    return state, desktop


def remote_path(state, relative):
    value = PurePosixPath(relative.replace('\\', '/'))
    if value.is_absolute() or '..' in value.parts or ':' in relative:
        raise ValueError('Remote path must be relative to the saved test directory')
    return state['cloud_root'].rstrip('/') + '/' + str(value)


def ps_quote(value):
    return "'" + value.replace("'", "''") + "'"


def invoke(script, state, user=True, timeout=120, label='command'):
    if len(script.encode('utf-8')) > 15000:
        raise ValueError('Command exceeds the bounded API payload; upload a script instead')
    args = {'DesktopId.1': state['desktop_id'], 'Type': 'RunPowerShellScript',
            'ContentEncoding': 'PlainText', 'CommandContent': script, 'Timeout': timeout}
    if user:
        args['EndUserId'] = json.loads(ACCOUNT.read_text(encoding='utf-8'))['end_user_id']
    response = api('RunCommand', args)
    evidence = STATE / 'evidence' / state['evidence_run'] / 'commands'
    record = evidence / (datetime.now(timezone.utc).strftime('%H%M%S') + '-' + label + '-' + response['InvokeId'])
    write_json(record.with_suffix('.request.json'), response)
    deadline = time.monotonic() + timeout + 90
    while time.monotonic() < deadline:
        # A read-only poll may be retried once; never silently replay a mutation.
        try:
            result = api('DescribeInvocations', {'InvokeId': response['InvokeId'], 'IncludeOutput': True,
                         'IncludeInvokeDesktops': True, 'ContentEncoding': 'PlainText'})
        except RuntimeError:
            result = api('DescribeInvocations', {'InvokeId': response['InvokeId'], 'IncludeOutput': True,
                         'IncludeInvokeDesktops': True, 'ContentEncoding': 'PlainText'})
        values = result.get('Invocations', [])
        if values and values[0]['InvocationStatus'] in ('Success', 'Failed', 'Timeout', 'PartialFailed', 'Cancelled', 'Stopped'):
            write_json(record.with_suffix('.result.json'), result)
            desktops = values[0].get('InvokeDesktops', [])
            if len(desktops) != 1 or desktops[0]['DesktopId'] != state['desktop_id']:
                raise RuntimeError('Unexpected command target/result')
            outcome = desktops[0]
            if (values[0]['InvocationStatus'] != 'Success' or outcome.get('ExitCode') != 0
                    or outcome.get('Dropped', 0) != 0 or outcome.get('InvocationStatus') != 'Success'):
                raise RuntimeError(json.dumps(values[0], ensure_ascii=False))
            return outcome.get('Output', '')
        time.sleep(2)
    raise TimeoutError('Command still pending: ' + response['InvokeId'])


def overlay(repo, output, include=None):
    repo = repo.resolve()
    def git(*args):
        return subprocess.check_output(['git', '-C', str(repo), *args])
    head = git('rev-parse', 'HEAD').decode().strip()
    files = set(git('diff', 'HEAD', '--name-only', '--diff-filter=d', '-z').decode().split('\0'))
    files.update(git('ls-files', '--others', '--exclude-standard', '-z').decode().split('\0'))
    files.discard('')
    if include is not None:
        missing = set(include) - files
        if missing:
            raise ValueError('Selected files are not current changes: ' + ', '.join(sorted(missing)))
        files.intersection_update(include)
    deleted = git('diff', 'HEAD', '--name-only', '--diff-filter=D', '-z').decode().split('\0')
    if any(deleted):
        raise RuntimeError('Overlay contains deletions; synchronize them explicitly before using this package')
    manifest = {'head': head, 'files': {}}
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(files):
            path = repo / name
            if path.is_symlink() or not path.is_file():
                raise RuntimeError('Unsupported overlay entry: ' + name)
            data = path.read_bytes()
            archive.writestr(name, data)
            manifest['files'][name] = hashlib.sha256(data).hexdigest()
        archive.writestr('UI-OVERLAY-MANIFEST.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    manifest['zip_sha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
    write_json(output.with_suffix('.manifest.json'), manifest)
    return {'head': head, 'files': len(manifest['files']), 'bytes': output.stat().st_size,
            'sha256': manifest['zip_sha256']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('status', 'start', 'stop'):
        commands.add_parser(name)
    adopt = commands.add_parser('adopt')
    adopt.add_argument('desktop_id')
    adopt.add_argument('--cloud-root', required=True)
    adopt.add_argument('--evidence-run', required=True)
    command = commands.add_parser('run')
    command.add_argument('script', type=Path)
    command.add_argument('--system', action='store_true', help='Only for machine tool preparation')
    command.add_argument('--timeout', type=int, default=120)
    upload = commands.add_parser('upload')
    upload.add_argument('local', type=Path)
    upload.add_argument('remote_relative')
    download = commands.add_parser('download')
    download.add_argument('remote_relative')
    download.add_argument('local', type=Path)
    pack = commands.add_parser('overlay')
    pack.add_argument('repo', type=Path)
    pack.add_argument('output', type=Path)
    pack.add_argument('--include', action='append', help='Exact approved repo-relative changed file; repeat to limit the overlay')
    args = parser.parse_args()
    if args.command == 'overlay':
        print(json.dumps(overlay(args.repo, args.output, args.include), ensure_ascii=False))
        return
    if args.command == 'adopt':
        desktop = describe(args.desktop_id)
        root = args.cloud_root.replace('\\', '/').rstrip('/')
        if not root.startswith('C:/Users/Public/LimeTest-') or '..' in PurePosixPath(root).parts or "'" in root:
            raise ValueError('Use a dedicated C:/Users/Public/LimeTest-* test directory')
        if Path(args.evidence_run).name != args.evidence_run or args.evidence_run in ('.', '..'):
            raise ValueError('Invalid evidence run name')
        value = {'desktop_id': args.desktop_id, 'cloud_root': root, 'evidence_run': args.evidence_run,
                 'region_id': json.loads(ACCOUNT.read_text(encoding='utf-8'))['region_id'], 'retention': 'session_choice',
                 'observed_at': datetime.now(timezone.utc).isoformat(), 'last_status': desktop['DesktopStatus']}
        write_json(ACTIVE, value)
        print(json.dumps(value, ensure_ascii=False))
        return
    state, desktop = current(args.command in ('run', 'upload', 'download'))
    if args.command == 'status':
        print(json.dumps({'saved': state, 'desktop': desktop}, ensure_ascii=False, indent=2))
    elif args.command in ('start', 'stop'):
        target = 'Running' if args.command == 'start' else 'Stopped'
        requested = False
        if desktop['DesktopStatus'] != target:
            expected = 'Stopped' if args.command == 'start' else 'Running'
            if desktop['DesktopStatus'] != expected:
                raise RuntimeError('Desktop is transitioning; inspect before another lifecycle request')
            params = {'DesktopId.1': state['desktop_id']}
            if args.command == 'stop':
                params['StoppedMode'] = 'StopCharging'
            response = api('StartDesktops' if args.command == 'start' else 'StopDesktops', params)
            requested = True
            write_json(STATE / 'evidence' / state['evidence_run'] / (args.command + '-receipt.json'), response)
            state['last_lifecycle_request'] = {'action': args.command, 'at': datetime.now(timezone.utc).isoformat()}
            write_json(ACTIVE, state)
        # A request receipt is not final state. Poll again with status if this bounded wait expires.
        deadline = time.monotonic() + 45
        while desktop['DesktopStatus'] != target and time.monotonic() < deadline:
            time.sleep(3)
            desktop = describe(state['desktop_id'])
        state['last_status'] = desktop['DesktopStatus']
        state['observed_at'] = datetime.now(timezone.utc).isoformat()
        write_json(ACTIVE, state)
        print(json.dumps({'desktop_id': state['desktop_id'], 'status': desktop['DesktopStatus'],
                          'compute_stop_requested': args.command == 'stop' and requested,
                          'requested_stopped_mode': 'StopCharging' if args.command == 'stop' and requested else None,
                          'compute_billing_status': 'not_verified', 'storage_still_billed': True}))
    elif args.command == 'run':
        print(invoke(args.script.read_text(encoding='utf-8-sig'), state, user=not args.system, timeout=args.timeout, label=args.script.stem))
    elif args.command == 'upload':
        data = args.local.read_bytes()
        encoded = base64.b64encode(data).decode()
        parts = [encoded[i:i + 12000] for i in range(0, len(encoded), 12000)]
        transfer = remote_path(state, 'transfer-' + uuid.uuid4().hex)
        def send(item):
            i, part = item
            path = ps_quote(f'{transfer}/{i:05}.txt')
            script = f"$ErrorActionPreference='Stop'\nNew-Item -ItemType Directory -Force {ps_quote(transfer)} | Out-Null\n[IO.File]::WriteAllText({path},'{part}')"
            # Rewriting this unique transfer chunk is idempotent, including a lost response.
            for attempt in range(3):
                try:
                    return invoke(script, state, label=f'upload-{i:05}')
                except (RuntimeError, TimeoutError, subprocess.TimeoutExpired):
                    if attempt == 2:
                        raise
                    time.sleep(1)
        with ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(send, enumerate(parts)))
        destination = ps_quote(remote_path(state, args.remote_relative))
        digest = hashlib.sha256(data).hexdigest()
        script = f"$ErrorActionPreference='Stop'\nNew-Item -ItemType Directory -Force (Split-Path {destination}) | Out-Null\n$b64=(Get-ChildItem {ps_quote(transfer + '/*.txt')} | Sort-Object Name | ForEach-Object {{[IO.File]::ReadAllText($_.FullName)}}) -join ''\n[IO.File]::WriteAllBytes({destination},[Convert]::FromBase64String($b64))\nif((Get-FileHash {destination} -Algorithm SHA256).Hash.ToLowerInvariant() -ne '{digest}'){{throw 'SHA256 mismatch'}}\n'upload-verified'"
        print(invoke(script, state, label='upload-verify').strip(), len(data), digest)
    elif args.command == 'download':
        source = ps_quote(remote_path(state, args.remote_relative))
        metadata = json.loads(invoke(f"$ErrorActionPreference='Stop'\n@{{length=(Get-Item {source}).Length;sha256=(Get-FileHash {source} -Algorithm SHA256).Hash.ToLowerInvariant()}} | ConvertTo-Json -Compress", state, label='download-metadata'))
        args.local.parent.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(args.local.parent).free < metadata['length'] * 2 + 10_000_000:
            raise RuntimeError('Not enough local space for the artifact and verified command receipts')
        def receive(offset):
            length = min(6000, metadata['length'] - offset)
            script = f"$ErrorActionPreference='Stop'\n$f=[IO.File]::OpenRead({source});try{{$null=$f.Seek({offset},[IO.SeekOrigin]::Begin);$b=New-Object byte[] {length};$n=$f.Read($b,0,$b.Length);if($n -ne $b.Length){{throw 'Short read'}};[Convert]::ToBase64String($b)}}finally{{$f.Dispose()}}"
            for attempt in range(3):
                try:
                    block = base64.b64decode(invoke(script, state, label=f'download-{offset}').strip(), validate=True)
                    if len(block) != length:
                        raise RuntimeError('Unexpected block length')
                    return offset, block
                except (RuntimeError, TimeoutError, subprocess.TimeoutExpired):
                    if attempt == 2:
                        raise
                    time.sleep(1)
        with args.local.open('wb') as output:
            with ThreadPoolExecutor(max_workers=3) as pool:
                for offset, block in pool.map(receive, range(0, metadata['length'], 6000)):
                    output.seek(offset)
                    output.write(block)
                    output.flush()
        if args.local.stat().st_size != metadata['length'] or hashlib.sha256(args.local.read_bytes()).hexdigest() != metadata['sha256']:
            raise RuntimeError('Downloaded file digest mismatch; partial file retained for diagnosis')
        print(json.dumps(metadata))


if __name__ == '__main__':
    main()
