#!/usr/bin/env python3
"""Scan the explicit public-source allowlist or a VSIX, without printing secret values."""
import argparse
import json
from pathlib import Path, PurePosixPath
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FILES = {
    '.gitignore', '.vscodeignore', 'package.json', 'package-lock.json', 'tsconfig.json',
    'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md',
    'CONTRIBUTING.md', 'CHANGELOG.md', 'FEASIBILITY.md',
}
DIRECTORIES = {'src', 'scripts', 'tests', 'resources', 'docs', 'third_party', '.github', '.vscode'}
TEXT_SUFFIXES = {'.ts', '.mjs', '.cjs', '.js', '.json', '.md', '.txt', '.yml', '.yaml', '.py', '.map'}
BINARY_SUFFIXES = {'.png', '.jpg', '.jpeg'}
RULES = {
    'private-key': re.compile(r'-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----'),
    'github-token': re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b'),
    'openai-key': re.compile(r'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b'),
    'aws-key': re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
    'personal-absolute-path': re.compile(r'/(?:Users|home|Volumes)/[A-Za-z0-9][^\s"\'<>`]*'),
    'windows-personal-path': re.compile(r'[A-Za-z]:[\\/]+Users[\\/]+[A-Za-z0-9][^\s"\'<>`]*'),
    'personal-email': re.compile(r'\b[A-Za-z0-9._%+-]+@(?:gmail\.com|qq\.com|163\.com|126\.com|outlook\.com|hotmail\.com)\b', re.I),
    'credential-in-url': re.compile(r'https?://[^\s/@:]+:[^\s/@]+@'),
    'literal-credential': re.compile(r'''(?:password|secret|api[_-]?key|(?:vsce|github|gh|ovsx)[_-]?(?:pat|token))\s*[:=]\s*["']([^"'\s]{16,})["']''', re.I),
}


def scan_text(name, text):
    findings = []
    for rule, pattern in RULES.items():
        for match in pattern.finditer(text):
            value = match.group(0)
            if rule == 'literal-credential' and any(marker in value for marker in ['process.env', '${{', 'secrets.', 'github.token']):
                continue
            findings.append({'file': name, 'line': text.count('\n', 0, match.start()) + 1, 'rule': rule})
    return findings


def public_files():
    result = []
    for name in sorted(FILES):
        p = ROOT / name
        if p.is_file():
            if p.is_symlink():
                raise ValueError('Public source cannot contain symlinks')
            result.append(p)
    for name in sorted(DIRECTORIES):
        parent = ROOT / name
        if not parent.exists():
            continue
        if parent.is_symlink():
            raise ValueError('Public source cannot contain symlink directories')
        for p in sorted(parent.rglob('*')):
            if p.is_symlink():
                raise ValueError('Public source cannot contain symlinks')
            if p.is_file():
                if '__pycache__' in p.parts:
                    continue
                result.append(p)
    return sorted(result)


def prohibited(name):
    p = PurePosixPath(name)
    blocked = {'.git', '.cache', '.vscode-test', 'node_modules', 'artifacts', '__pycache__'}
    return bool(blocked.intersection(p.parts)) or p.name.startswith('.env') or p.name in {'.vsce', '.npmrc'} or p.suffix.lower() in {'.pem', '.key', '.p12', '.pfx', '.log', '.original', '.rollback'}


def inspect_entries(entries):
    findings = []
    count = 0
    for name, data in entries:
        count += 1
        if prohibited(name):
            findings.append({'file': name, 'rule': 'excluded-private-or-generated-file'})
        suffix = PurePosixPath(name).suffix.lower()
        if suffix in BINARY_SUFFIXES:
            if suffix == '.png' and not data.startswith(b'\x89PNG\r\n\x1a\n'):
                findings.append({'file': name, 'rule': 'invalid-png'})
            if suffix in {'.jpg', '.jpeg'} and not data.startswith(b'\xff\xd8\xff'):
                findings.append({'file': name, 'rule': 'invalid-jpeg'})
            continue
        try:
            text = data.decode('utf-8-sig')
        except UnicodeDecodeError:
            findings.append({'file': name, 'rule': 'unexpected-binary'})
            continue
        findings.extend(scan_text(name, text))
        if suffix not in TEXT_SUFFIXES and PurePosixPath(name).name not in {'LICENSE', '.gitignore', '.vscodeignore', '[Content_Types].xml', 'extension.vsixmanifest', 'LICENSE.txt'}:
            findings.append({'file': name, 'rule': 'unexpected-file-type'})
    return count, findings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--vsix', type=Path)
    parser.add_argument('--manifest', type=Path)
    args = parser.parse_args()
    if args.vsix:
        with zipfile.ZipFile(args.vsix) as archive:
            entries = [(entry.filename, archive.read(entry)) for entry in archive.infolist() if not entry.is_dir()]
        count, findings = inspect_entries(entries)
        files = [name for name, _ in entries]
        mode = 'vsix'
    else:
        paths = public_files()
        files = [p.relative_to(ROOT).as_posix() for p in paths]
        count, findings = inspect_entries((name, p.read_bytes()) for name, p in zip(files, paths))
        mode = 'public-source'
        for required in ['LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'third_party/pyright/LICENSE.txt', 'resources/provenance.json']:
            if required not in files:
                findings.append({'file': required, 'rule': 'missing-release-document'})
    report = {'mode': mode, 'filesScanned': count, 'findings': findings, 'passed': not findings}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.manifest and not findings:
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        args.manifest.write_text(json.dumps(files, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return 1 if findings else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'passed': False, 'error': type(error).__name__}), file=sys.stderr)
        sys.exit(1)
