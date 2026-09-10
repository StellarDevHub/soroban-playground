# 🛡️ Security Vulnerability & Audit Advisory
**Target Repository**: `StellarDevHub/soroban-playground`
**Audit Date**: `2026-09-10 20:15:23 UTC`
**Target Bounty**: $150

## 📋 Executive Summary of Findings

| Severity | Category | Description | File Location |
|---|---|---|---|
| **High** | Exposed Secret / Key Leak | Generic API/Secret Key | `backend/tests/kmsService.test.js:23` |
| **High** | Exposed Secret / Key Leak | Generic API/Secret Key | `backend/tests/webhook.test.js:17` |
| **High** | Exposed Secret / Key Leak | Generic API/Secret Key | `backend/tests/webhook.test.js:56` |
| **High** | Exposed Secret / Key Leak | Generic API/Secret Key | `backend/tests/webhook.test.js:130` |
| **High** | Exposed Secret / Key Leak | Generic API/Secret Key | `backend/tests/issues_1024_1029_1027_1026.test.js:115` |
| **High** | Exposed Secret / Key Leak | Generic API/Secret Key | `backend/tests/tenantIsolation.test.js:112` |
| **High** | Exposed Secret / Key Leak | Generic API/Secret Key | `backend/tests/tenantIsolation.test.js:121` |
| **High** | Exposed Secret / Key Leak | Generic API/Secret Key | `backend/tests/tenantIsolation.test.js:149` |
| **High** | Exposed Secret / Key Leak | Generic API/Secret Key | `backend/tests/tenantIsolation.test.js:172` |
| **High** | Exposed Secret / Key Leak | Generic API/Secret Key | `backend/tests/tenantIsolation.test.js:180` |

## 🔍 Proof of Concept (PoC) & Details

### Finding #1: Generic API/Secret Key
- **File**: `backend/tests/kmsService.test.js` (Line 23)
- **Severity Level**: `High`
- **Evidence Snippet**: `secret: 'SSE...[REDACTED]`
- **Impact**: Potential unauthorized access, data exposure, or client-side integrity risks.
- **Remediation**: Sanitize inputs, enforce explicit origin checks, and rotate exposed credentials immediately.

### Finding #2: Generic API/Secret Key
- **File**: `backend/tests/webhook.test.js` (Line 17)
- **Severity Level**: `High`
- **Evidence Snippet**: `secret = 'su...[REDACTED]`
- **Impact**: Potential unauthorized access, data exposure, or client-side integrity risks.
- **Remediation**: Sanitize inputs, enforce explicit origin checks, and rotate exposed credentials immediately.

### Finding #3: Generic API/Secret Key
- **File**: `backend/tests/webhook.test.js` (Line 56)
- **Severity Level**: `High`
- **Evidence Snippet**: `secret = 've...[REDACTED]`
- **Impact**: Potential unauthorized access, data exposure, or client-side integrity risks.
- **Remediation**: Sanitize inputs, enforce explicit origin checks, and rotate exposed credentials immediately.

### Finding #4: Generic API/Secret Key
- **File**: `backend/tests/webhook.test.js` (Line 130)
- **Severity Level**: `High`
- **Evidence Snippet**: `secret = 'de...[REDACTED]`
- **Impact**: Potential unauthorized access, data exposure, or client-side integrity risks.
- **Remediation**: Sanitize inputs, enforce explicit origin checks, and rotate exposed credentials immediately.

### Finding #5: Generic API/Secret Key
- **File**: `backend/tests/issues_1024_1029_1027_1026.test.js` (Line 115)
- **Severity Level**: `High`
- **Evidence Snippet**: `secret = 'su...[REDACTED]`
- **Impact**: Potential unauthorized access, data exposure, or client-side integrity risks.
- **Remediation**: Sanitize inputs, enforce explicit origin checks, and rotate exposed credentials immediately.

### Finding #6: Generic API/Secret Key
- **File**: `backend/tests/tenantIsolation.test.js` (Line 112)
- **Severity Level**: `High`
- **Evidence Snippet**: `secret: 'ten...[REDACTED]`
- **Impact**: Potential unauthorized access, data exposure, or client-side integrity risks.
- **Remediation**: Sanitize inputs, enforce explicit origin checks, and rotate exposed credentials immediately.

### Finding #7: Generic API/Secret Key
- **File**: `backend/tests/tenantIsolation.test.js` (Line 121)
- **Severity Level**: `High`
- **Evidence Snippet**: `secret: 'ten...[REDACTED]`
- **Impact**: Potential unauthorized access, data exposure, or client-side integrity risks.
- **Remediation**: Sanitize inputs, enforce explicit origin checks, and rotate exposed credentials immediately.

### Finding #8: Generic API/Secret Key
- **File**: `backend/tests/tenantIsolation.test.js` (Line 149)
- **Severity Level**: `High`
- **Evidence Snippet**: `secret: 'ten...[REDACTED]`
- **Impact**: Potential unauthorized access, data exposure, or client-side integrity risks.
- **Remediation**: Sanitize inputs, enforce explicit origin checks, and rotate exposed credentials immediately.

### Finding #9: Generic API/Secret Key
- **File**: `backend/tests/tenantIsolation.test.js` (Line 172)
- **Severity Level**: `High`
- **Evidence Snippet**: `secret: 'ten...[REDACTED]`
- **Impact**: Potential unauthorized access, data exposure, or client-side integrity risks.
- **Remediation**: Sanitize inputs, enforce explicit origin checks, and rotate exposed credentials immediately.

### Finding #10: Generic API/Secret Key
- **File**: `backend/tests/tenantIsolation.test.js` (Line 180)
- **Severity Level**: `High`
- **Evidence Snippet**: `secret: 'ten...[REDACTED]`
- **Impact**: Potential unauthorized access, data exposure, or client-side integrity risks.
- **Remediation**: Sanitize inputs, enforce explicit origin checks, and rotate exposed credentials immediately.
