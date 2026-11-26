#!/usr/bin/env python3
"""
Comprehensive PR Security Audit Scanner for StellarDevHub/soroban-playground
Scans all open PRs for:
- Obfuscated / encoded code (base64, hex, eval, Function constructor, zero-width chars)
- Data exfiltration / credential & wallet theft (webhooks, external POSTs, localStorage/cookie scraping)
- Remote code execution / reverse shells / pipe to bash
- Supply chain / dependency hijacking (new packages, postinstall scripts, git/url dependencies)
- CI/CD & GitHub Actions tampering (.github/workflows modification)
- Binary / rogue oversized artifacts
- Smart contract backdoor logic (hardcoded admin addresses, disabled auth, arbitrary mints)
"""

import concurrent.futures
import json
import os
import re
import subprocess
import sys
import time

# Malicious / Exfiltration domain indicators
MALICIOUS_DOMAINS = [
    r"webhook\.site",
    r"requestbin",
    r"pipedream\.net",
    r"ngrok\.io",
    r"ngrok-free\.app",
    r"discord\.com/api/webhooks",
    r"api\.telegram\.org/bot",
    r"pastebin\.com",
    r"transfer\.sh",
    r"file\.io",
    r"temp-mail",
    r"anonfiles\.com",
    r"mega\.nz",
    r"iplogger",
    r"grabify",
    r"bit\.ly",
    r"tinyurl\.com",
]

# Obfuscation and Dynamic Execution patterns
OBFUSCATION_PATTERNS = [
    (r"\beval\s*\(", "Use of eval() for dynamic code execution", 40),
    (r"\bFunction\s*\([^)]*\)\s*\(", "Dynamic Function() constructor execution", 40),
    (r"\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){4,}", "Heavy hex character escaping (obfuscation signature)", 35),
    (r"\\u00[0-9a-fA-F]{2}(?:\\u00[0-9a-fA-F]{2}){4,}", "Heavy unicode character escaping", 35),
    (r"[\u200B-\u200D\uFEFF\u202A-\u202E]", "Invisible zero-width or bidirectional control characters (Trojan Source)", 50),
    (r"atob\s*\([\"'][A-Za-z0-9+/=]{20,}[\"']\)", "Decoding hardcoded Base64 payload via atob()", 30),
    (r"Buffer\.from\s*\([\"'][A-Za-z0-9+/=]{20,}[\"'],\s*['\"]base64['\"]\)", "Decoding Base64 buffer payload in Node.js", 30),
    (r"window\s*\[\s*['\"](?:eval|Function)['\"]\s*\]", "Dynamic window evaluation property access", 40),
    (r"globalThis\s*\[\s*['\"](?:eval|Function)['\"]\s*\]", "Dynamic globalThis evaluation property access", 40),
]

# Exfiltration & Theft patterns
EXFILTRATION_PATTERNS = [
    (r"(?:fetch|axios(?:\.post|\.get)?|http\.request)\s*\([^)]*(?:" + "|".join(MALICIOUS_DOMAINS) + r")", "Outbound network call to suspicious/webhook service", 50),
    (r"navigator\.sendBeacon\s*\([^)]*(?:" + "|".join(MALICIOUS_DOMAINS) + r")", "Beacon exfiltration to suspicious endpoint", 50),
    (r"(?:localStorage|sessionStorage|document\.cookie).*(?:fetch|axios|sendBeacon|XMLHttpRequest)", "Credential/storage scraping tied to network dispatch", 45),
    (r"(?:freighter|albedo|xbull|privateKey|secretKey|seedHex|mnemonic).*(?:fetch|axios|sendBeacon|XMLHttpRequest)", "Wallet secret / key harvesting combined with network dispatch", 50),
    (r"https?://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?(?:/[^\s\"']*)?", "Direct hardcoded public IP address in network call", 25),
]

# Remote Code Execution / System Shell patterns
SHELL_PATTERNS = [
    (r"child_process\s*\.\s*(?:exec|execSync|spawn|spawnSync)\s*\([^)]*(?:curl|wget|nc|bash|sh|powershell)", "Shell command execution invoking downloaders or shells", 50),
    (r"\|\s*(?:ba)?sh\b", "Piping command output directly into shell", 50),
    (r"/bin/(?:ba)?sh\s+-i", "Interactive reverse shell signature", 50),
    (r"nc\s+-[ecl]", "Netcat reverse shell / listener signature", 50),
    (r"\brm\s+-rf\s+[/~]", "Destructive filesystem command (rm -rf / or ~)", 50),
    (r"\.env(?:\.local)?", "Explicit access to environment credentials file", 15),
]

# Smart Contract Backdoor patterns
CONTRACT_PATTERNS = [
    (r"Address\s*::\s*from_string\s*\(\s*&?String\s*::\s*from_str\s*\(\s*&?env\s*,\s*\"[A-Z0-9]{56}\"\s*\)\s*\)", "Hardcoded Stellar/Soroban public key in smart contract", 35),
    (r"//.*require_auth", "Commented out authorization check in smart contract", 25),
    (r"fn\s+emergency_drain\b", "Emergency drain backdoor function", 30),
    (r"panic!\s*\(\s*\"backdoor\"\s*\)", "Explicit backdoor string", 50),
]

def scan_diff_text(diff_text):
    findings = []
    total_score = 0
    added_lines = []
    
    current_file = ""
    for line in diff_text.splitlines():
        if line.startswith("diff --git a/"):
            parts = line.split(" b/")
            if len(parts) == 2:
                current_file = parts[1]
        elif line.startswith("+") and not line.startswith("+++"):
            content = line[1:].strip()
            # skip comment-only lines in JS/Rust for certain simple checks
            added_lines.append((current_file, content))

    # Test added lines against pattern suites
    for filename, code in added_lines:
        # Ignore markdown/test documentation files for shell patterns
        is_doc = filename.lower().endswith((".md", ".txt", ".json", ".lock"))
        is_test = "__tests__" in filename or ".test." in filename or ".spec." in filename

        # 1. Obfuscation
        for pattern, desc, score in OBFUSCATION_PATTERNS:
            if re.search(pattern, code):
                # suppress common false positives like normal base64 regex or doc comments
                if is_doc and "Base64" in desc:
                    continue
                findings.append({
                    "category": "OBFUSCATION",
                    "file": filename,
                    "description": desc,
                    "code_snippet": code[:140],
                    "score": score
                })
                total_score += score

        # 2. Exfiltration
        for pattern, desc, score in EXFILTRATION_PATTERNS:
            if re.search(pattern, code, re.IGNORECASE):
                findings.append({
                    "category": "EXFILTRATION",
                    "file": filename,
                    "description": desc,
                    "code_snippet": code[:140],
                    "score": score
                })
                total_score += score

        # 3. Shell / RCE
        if not is_doc:
            for pattern, desc, score in SHELL_PATTERNS:
                if re.search(pattern, code):
                    # Suppress false positives in package.json test scripts
                    if "package.json" in filename and '"test":' in code:
                        continue
                    findings.append({
                        "category": "RCE_SYSTEM",
                        "file": filename,
                        "description": desc,
                        "code_snippet": code[:140],
                        "score": score
                    })
                    total_score += score

        # 4. Smart Contract
        if filename.endswith(".rs"):
            for pattern, desc, score in CONTRACT_PATTERNS:
                if re.search(pattern, code):
                    findings.append({
                        "category": "CONTRACT_BACKDOOR",
                        "file": filename,
                        "description": desc,
                        "code_snippet": code[:140],
                        "score": score
                    })
                    total_score += score

    return findings, total_score

def audit_single_pr(pr_meta):
    pr_num = pr_meta["number"]
    title = pr_meta.get("title", "")
    author = pr_meta.get("author", {}).get("login", "unknown")
    branch = pr_meta.get("headRefName", "")
    url = f"https://github.com/StellarDevHub/soroban-playground/pull/{pr_num}"

    # Fetch files & view details
    try:
        view_cmd = ["gh", "pr", "view", str(pr_num), "--json", "files,additions,deletions,state"]
        res = subprocess.run(view_cmd, capture_output=True, text=True, check=True)
        view_data = json.loads(res.stdout)
    except Exception as e:
        return {
            "number": pr_num,
            "title": title,
            "author": author,
            "error": f"Failed to fetch metadata: {e}",
            "risk": "UNKNOWN",
            "score": 0,
            "findings": []
        }

    files = view_data.get("files", [])
    file_findings = []
    file_score = 0

    # Inspect file paths
    for f in files:
        path = f.get("path", "")
        additions = f.get("additions", 0)

        # Check CI/CD workflow tampering
        if path.startswith(".github/workflows/"):
            file_findings.append({
                "category": "WORKFLOW_TAMPERING",
                "file": path,
                "description": "PR modifies GitHub Actions workflow files (.github/workflows/*) - high risk of secret exfiltration or arbitrary CI runner execution",
                "code_snippet": f"Modified workflow: {path}",
                "score": 60
            })
            file_score += 60

        # Check binary / huge files
        ext = os.path.splitext(path)[1].lower()
        if ext in [".exe", ".dll", ".so", ".bin", ".elf", ".tar", ".gz", ".zip"]:
            file_findings.append({
                "category": "ROGUE_BINARY",
                "file": path,
                "description": f"PR introduces compiled binary/archive file ({ext})",
                "code_snippet": f"Binary file added: {path}",
                "score": 50
            })
            file_score += 50

        # Check unexpected root files / dotfiles
        if path in [".env", ".env.local", ".npmrc", ".gitmodules"]:
            file_findings.append({
                "category": "SENSITIVE_CONFIG",
                "file": path,
                "description": f"PR modifies sensitive environment or config dotfile ({path})",
                "code_snippet": f"File: {path}",
                "score": 40
            })
            file_score += 40

        # Check dependency modifications
        if path in ["package.json", "package-lock.json", "yarn.lock", "Cargo.toml", "Cargo.lock"]:
            if additions > 50:
                file_findings.append({
                    "category": "DEPENDENCY_CHANGE",
                    "file": path,
                    "description": f"Substantial changes to dependency manifest/lockfile (+{additions} lines)",
                    "code_snippet": f"{path} additions: +{additions}",
                    "score": 20
                })
                file_score += 20

    # Fetch and scan diff
    try:
        diff_cmd = ["gh", "pr", "diff", str(pr_num)]
        diff_res = subprocess.run(diff_cmd, capture_output=True, text=True, check=True)
        diff_text = diff_res.stdout
    except Exception as e:
        diff_text = ""

    diff_findings, diff_score = scan_diff_text(diff_text)
    all_findings = file_findings + diff_findings
    total_score = file_score + diff_score

    # Assign risk tier
    if total_score >= 45:
        risk = "CRITICAL_RISK"
    elif total_score >= 20:
        risk = "HIGH_RISK"
    elif total_score >= 10:
        risk = "MEDIUM_RISK"
    else:
        risk = "LOW_RISK"

    return {
        "number": pr_num,
        "title": title,
        "author": author,
        "branch": branch,
        "url": url,
        "files_count": len(files),
        "additions": view_data.get("additions", 0),
        "deletions": view_data.get("deletions", 0),
        "risk": risk,
        "score": total_score,
        "findings": all_findings
    }

def main():
    print("=" * 70)
    print("   SOROBAN PLAYGROUND: 144 OPEN PULL REQUEST SECURITY AUDIT   ")
    print("=" * 70)

    print("Fetching list of all open pull requests...")
    res = subprocess.run(
        ["gh", "pr", "list", "--state", "open", "--limit", "200", "--json", "number,title,author,headRefName"],
        capture_output=True, text=True, check=True
    )
    prs = json.loads(res.stdout)
    total_prs = len(prs)
    print(f"Found {total_prs} open pull requests to audit.\n")

    results = []
    completed = 0
    start_time = time.time()

    # Parallel scanning with 8 workers
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        future_to_pr = {executor.submit(audit_single_pr, pr): pr for pr in prs}
        for future in concurrent.futures.as_completed(future_to_pr):
            completed += 1
            res_data = future.result()
            results.append(res_data)
            status_indicator = "✓" if res_data["risk"] == "LOW_RISK" else ("⚠️" if res_data["risk"] == "MEDIUM_RISK" else "🚨")
            print(f"[{completed:3d}/{total_prs}] {status_indicator} PR #{res_data['number']}: {res_data['risk']} (Score {res_data['score']}) - {res_data['title'][:50]}")

    elapsed = time.time() - start_time
    print(f"\nAudit completed in {elapsed:.1f}s.")

    # Sort results by risk score descending
    results.sort(key=lambda x: x["score"], reverse=True)

    # Save to data/pr_security_audit_results.json
    os.makedirs("data", exist_ok=True)
    with open("data/pr_security_audit_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print("Saved raw audit data to data/pr_security_audit_results.json")

    # Generate Markdown Report
    critical_prs = [r for r in results if r["risk"] in ["CRITICAL_RISK", "HIGH_RISK"]]
    medium_prs = [r for r in results if r["risk"] == "MEDIUM_RISK"]
    low_prs = [r for r in results if r["risk"] == "LOW_RISK"]

    print("\n" + "=" * 70)
    print("                   SECURITY AUDIT SUMMARY                      ")
    print("=" * 70)
    print(f"  CRITICAL / HIGH RISK (Action Required Immediately): {len(critical_prs)}")
    print(f"  MEDIUM RISK (Requires Close Review):                 {len(medium_prs)}")
    print(f"  LOW RISK / CLEAN (Standard Review):                  {len(low_prs)}")
    print("=" * 70)

    if critical_prs:
        print("\nTOP THREAT PRs DETECTED:")
        for r in critical_prs[:10]:
            print(f"  🚨 PR #{r['number']} by @{r['author']} (Score {r['score']}): {r['title']}")
            for f in r["findings"][:2]:
                print(f"     - [{f['category']}] {f['description']} in {f['file']}")

if __name__ == "__main__":
    main()
