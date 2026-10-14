"""Time an interactive CLI command, recording approval waiting separately."""
import argparse
import codecs
import json
import os
import pty
import re
import select
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--label', required=True)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('command', nargs=argparse.REMAINDER)
args = parser.parse_args()
command = args.command[1:] if args.command[:1] == ['--'] else args.command
if not command:
    parser.error('Supply the CLI command after --')
if not re.fullmatch(r'[a-z0-9_-]+', args.label):
    parser.error('Use a plain benchmark label without infrastructure identifiers')

def sanitize(value):
    value = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', value)
    return re.sub(r'https?://[^\s]+|arn:[^\s]+|\b\d{12}\b|\brev-[a-z0-9]{5}\b', '[withheld]', value)

def is_prompt(value):
    return bool(re.search(r'Do you wish|Are you sure|Continue\?|\[y/n\]|\(y/n\)', value, re.I))

master, slave = pty.openpty()
started_at = datetime.now(timezone.utc).isoformat()
started = time.monotonic()
process = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
waiting_since = None
approval_wait = 0.0
last_approval = None
pending = ''
decoder = codecs.getincrementaldecoder('utf-8')(errors='replace')
stdin_open = True
try:
    while True:
        readers = [master]
        if stdin_open:
            readers.append(sys.stdin.fileno())
        readable, _, _ = select.select(readers, [], [], 1)
        if sys.stdin.fileno() in readable:
            data = os.read(sys.stdin.fileno(), 1024)
            if data:
                if waiting_since is not None:
                    now = time.monotonic()
                    approval_wait += now - waiting_since
                    waiting_since = None
                    last_approval = now
                os.write(master, data)
            else:
                stdin_open = False
        if master in readable:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            pending += decoder.decode(data)
            while '\n' in pending:
                line, pending = pending.split('\n', 1)
                clean = sanitize(line).strip()
                if is_prompt(clean) and waiting_since is None:
                    waiting_since = time.monotonic()
                if clean and clean != '…' and not any(c in clean for c in ('│', '┌', '├', '└')):
                    print(clean, flush=True)
            if is_prompt(sanitize(pending)):
                print(sanitize(pending).strip(), flush=True)
                pending = ''
                if waiting_since is None:
                    waiting_since = time.monotonic()
        elif process.poll() is not None:
            break
    if pending.strip():
        print(sanitize(pending).strip(), flush=True)
finally:
    os.close(master)
code = process.wait()
ended = time.monotonic()
record = {
    'label': args.label,
    'startedAt': started_at,
    'exitCode': code,
    'wallSecondsIncludingApproval': round(ended - started, 3),
    'approvalWaitSeconds': round(approval_wait, 3),
    'wallSecondsExcludingApproval': round(ended - started - approval_wait, 3),
    'afterLastApprovalSeconds': round(ended - last_approval, 3) if last_approval else None,
}
args.output.parent.mkdir(parents=True, exist_ok=True)
records = json.loads(args.output.read_text()) if args.output.exists() else []
records.append(record)
args.output.write_text(json.dumps(records, indent=2) + '\n')
print('Recorded timing without CLI arguments or live infrastructure identifiers', flush=True)
raise SystemExit(code)
