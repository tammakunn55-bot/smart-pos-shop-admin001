#!/usr/bin/env python3
"""SmartPOS GitHub preflight: fail on likely secrets or real local data."""
from pathlib import Path
import re, sys

ROOT = Path(__file__).resolve().parents[1]
TEXT_EXT = {'.js','.html','.css','.sql','.md','.txt','.json','.yml','.yaml','.toml','.env'}
IGNORE_DIRS = {'.git','node_modules','dist','build','.next'}
PATTERNS = [
    ('embedded service_role/secret value', re.compile(r'(?i)(?:service[_-]?role|sb_secret)\s*[:=]\s*[\"\'][^\"\']{8,}[\"\']')),
    ('JWT secret/private key', re.compile(r'(?i)-----BEGIN [A-Z ]*PRIVATE KEY-----|jwt[_-]?secret')),
    ('credential URI', re.compile(r'(?i)postgres(?:ql)?://[^\s"\']+')),
    ('common API token', re.compile(r'(?<![A-Za-z0-9])[A-Za-z0-9_-]{0,10}(?:sk|ghp|gho|github_pat)_[A-Za-z0-9_-]{20,}')),
    ('Google API key', re.compile(r'AIza[0-9A-Za-z_-]{20,}')),
]
# service_role text in documentation is allowed only when it is clearly a warning.
ALLOWED_SERVICE_ROLE_LINES = re.compile(r'(?i)(ห้าม|never|do not|no service_role|service_role.*key.*client|secret key)')

issues=[]
for p in ROOT.rglob('*'):
    if not p.is_file() or any(part in IGNORE_DIRS for part in p.parts):
        continue
    rel=p.relative_to(ROOT)
    # Hard block obviously unsafe artifacts.
    if p.suffix.lower() in {'.pem','.key','.p12','.pfx','.crt','.env'}:
        issues.append((str(rel),0,'credential/certificate file'))
        continue
    if p.name.lower() in {'credentials.json','secrets.json','service-account.json'}:
        issues.append((str(rel),0,'credential file'))
        continue
    if p.suffix.lower() not in TEXT_EXT:
        continue
    try: text=p.read_text(encoding='utf-8', errors='ignore')
    except Exception: continue
    for i,line in enumerate(text.splitlines(),1):
        for name,rx in PATTERNS:
            if rx.search(line):
                if name=='service_role/secret key' and ALLOWED_SERVICE_ROLE_LINES.search(line):
                    continue
                issues.append((str(rel),i,name))

if issues:
    print('SECURITY PREFLIGHT: FAIL')
    for x in issues[:100]: print(f'- {x[0]}:{x[1]}: {x[2]}')
    sys.exit(1)
print('SECURITY PREFLIGHT: PASS')
print('No obvious service_role/secret/private-key/credential artifacts found.')
