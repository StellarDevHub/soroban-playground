#!/usr/bin/env python3
"""
Close and remove all pull requests containing malicious code, workflow tampering,
Trojan Source invisible characters, dynamic code evaluation, or dirty branch contamination.
"""

import subprocess
import sys
import time

PR_CLOSURES = [
    # 1. Contaminated / Trojan Horse Branches (nanaabdul1172)
    (2169, "Rejected and closed: Severe branch contamination and scope creep. Bundles unrelated backend/gRPC/cluster files into this PR. Please submit a clean branch from latest main containing only files relevant to the issue."),
    (2167, "Rejected and closed: Severe branch contamination and scope creep. Bundles unrelated backend/gRPC/cluster files into this PR. Please submit a clean branch from latest main containing only files relevant to the issue."),
    (2161, "Rejected and closed: Severe branch contamination and scope creep. Bundles unrelated backend/gRPC/cluster files into this PR. Please submit a clean branch from latest main containing only files relevant to the issue."),

    # 2. CI/CD Workflow Tampering & Unauthorized CI Execution
    (2159, "Rejected and closed: Security violation - PR modifies `.github/workflows/ci.yml` to execute privileged `sudo apt-get install` commands in CI runners. External contributor PRs are strictly prohibited from modifying workflow files."),
    (2165, "Rejected and closed: Security violation - PR modifies `.github/workflows/ci.yml` to execute custom unvetted scripts and introduces invisible UTF-8 Byte Order Mark characters. Contributor PRs must not alter CI workflows."),
    (2162, "Rejected and closed: Security violation - Duplicate of #2165. PR modifies `.github/workflows/ci.yml` and contains invisible Unicode characters. Contributor PRs must not alter CI workflows."),
    (2194, "Rejected and closed: Security violation - PR modifies `.github/workflows/ci.yml` to spin up unapproved Docker container services. CI infrastructure changes must be managed directly by repository maintainers on main."),
    (2206, "Rejected and closed: Security violation - PR modifies `.github/workflows/ci.yml`. External PRs are prohibited from modifying CI workflow pipelines."),
    (2213, "Rejected and closed: Security violation - PR modifies `.github/workflows/ci.yml`. External PRs are prohibited from modifying CI workflow pipelines."),
    (2209, "Rejected and closed: Security violation - PR modifies `.github/workflows/ci.yml`. External PRs are prohibited from modifying CI workflow pipelines."),
    (2222, "Rejected and closed: Security violation - PR modifies `.github/workflows/ci.yml`. External PRs are prohibited from modifying CI workflow pipelines."),
    (2139, "Rejected and closed: Security violation & scope creep - PR modifies `.github/workflows/ci.yml` and introduces extensive unexpected modifications across 21 files including Cargo.lock."),
    (2138, "Rejected and closed: Security violation & scope creep - PR modifies `.github/workflows/ci.yml` and alters Cargo.lock. Contributor PRs must not alter CI workflows."),
    (1929, "Rejected and closed: Security violation - PR modifies `.github/workflows/ci.yml`. External PRs are prohibited from modifying CI workflow pipelines."),

    # 3. Trojan Source / Invisible Characters / Dynamic Code Execution
    (2158, "Rejected and closed: Code safety violation - Introduced invisible UTF-8 BOM characters (\uFEFF) in source files, which trigger Trojan Source warnings. Please clean your file encoding and resubmit with clean UTF-8."),
    (2104, "Rejected and closed: Security policy violation - Contains dynamic `eval()` execution in source code. Dynamic runtime code evaluation is strictly forbidden under repository security standards."),
    (2166, "Rejected and closed: Security policy violation - Contains dynamic `new Function()` code constructor execution. Dynamic runtime code evaluation is strictly forbidden under repository security standards.")
]

def main():
    print(f"Starting closure of {len(PR_CLOSURES)} flagged/malicious pull requests...")
    success_count = 0

    for i, (pr_num, comment) in enumerate(PR_CLOSURES, start=1):
        print(f"[{i:2d}/{len(PR_CLOSURES)}] Closing PR #{pr_num}...")
        try:
            cmd = ["gh", "pr", "close", str(pr_num), "--comment", comment]
            res = subprocess.run(cmd, capture_output=True, text=True, check=True)
            print(f"  ✓ PR #{pr_num} closed successfully.")
            success_count += 1
        except subprocess.CalledProcessError as e:
            err = e.stderr.strip()
            if "already closed" in err.lower():
                print(f"  ℹ PR #{pr_num} was already closed.")
                success_count += 1
            else:
                print(f"  ✗ Failed to close PR #{pr_num}: {err}")
        time.sleep(1.2)  # Avoid secondary GitHub rate limit

    print("\n" + "=" * 60)
    print(f"Closure complete! {success_count}/{len(PR_CLOSURES)} PRs closed.")
    print("=" * 60)

if __name__ == "__main__":
    main()
