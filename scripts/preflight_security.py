from pathlib import Path
import re, sys
ROOT=Path(__file__).resolve().parents[1]
TEXT_EXT={'.html','.js','.ts','.tsx','.jsx','.css','.json','.sql','.md','.txt','.yml','.yaml','.env'}
PATTERNS=[
 ('service_role', r'(?i)service[_-]?role\s*[:=]\s*["\'][^"\']+["\']'),
 ('sb_secret', r'(?i)sb_secret_[A-Za-z0-9_\-]+'),
 ('private_key', r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'),
 ('postgres_password', r'(?i)postgres(?:ql)?://[^\s:@]+:[^\s@]+@'),
 ('github_token', r'(?i)gh[pousr]_[A-Za-z0-9_]{20,}'),
 ('aws_access_key', r'\bAKIA[0-9A-Z]{16}\b'),
]
IGNORE={'node_modules','.git','dist','build','coverage'}
issues=[]
for p in ROOT.rglob('*'):
    if not p.is_file() or any(part in IGNORE for part in p.parts): continue
    if p.suffix.lower() not in TEXT_EXT: continue
    try: text=p.read_text(encoding='utf-8',errors='ignore')
    except: continue
    for name,pat in PATTERNS:
        for m in re.finditer(pat,text):
            line=text.count('\n',0,m.start())+1
            issues.append((p.relative_to(ROOT),line,name))
# check required frontend ids
html=(ROOT/'index.html').read_text(encoding='utf-8',errors='ignore')
required=['setup-store-name','setup-owner-email','setup-supabase-url','setup-supabase-key','setup-user-password','setup-user-password-confirm','login-owner-email','login-owner-password']
for x in required:
    if f'id="{x}"' not in html: issues.append(('index.html',0,'missing-id:'+x))
if 'id="setup-user-id"' in html: issues.append(('index.html',0,'legacy-setup-user-id'))
if 'id="login-user-id"' in html: issues.append(('index.html',0,'legacy-login-user-id'))
if issues:
    print('SECURITY PREFLIGHT: FAIL')
    for i in issues: print(f'{i[0]}:{i[1]} {i[2]}')
    sys.exit(1)
print('SECURITY PREFLIGHT: PASS')
print('No obvious hard-coded secrets/private keys found; owner setup uses runtime Supabase credentials and Auth.')
