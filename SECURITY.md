# Security Policy

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability within ContextGraph OS, please report it by emailing the maintainers directly or using GitHub's private vulnerability reporting feature.

### How to Report

1. Go to the [Security tab](https://github.com/akz4ol/contextgraph-os-core/security) of this repository
2. Click "Report a vulnerability"
3. Provide detailed information about the vulnerability

### What to Include

- Type of vulnerability
- Full paths of affected source files
- Location of the affected source code (tag/branch/commit)
- Step-by-step instructions to reproduce
- Proof-of-concept or exploit code (if possible)
- Impact of the issue

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Fix Timeline**: Depends on severity

| Severity | Target Fix Time |
|----------|-----------------|
| Critical | 24-48 hours     |
| High     | 7 days          |
| Medium   | 30 days         |
| Low      | 90 days         |

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Security Measures

### In the Codebase

- All dependencies are regularly updated via Dependabot
- CodeQL analysis runs on every push and weekly
- Dependency vulnerability scanning on all PRs
- Secret scanning enabled
- Required code review before merge

### Design Principles

ContextGraph OS is designed with security in mind:

- **Immutability**: All state changes are append-only, preventing tampering
- **Content Addressing**: IDs are derived from content, ensuring integrity
- **Policy Enforcement**: Actions are evaluated against policies before execution
- **Non-repudiation**: Every action is bound to an authenticated actor
- **Audit Trail**: Complete provenance for all decisions

## Security Best Practices for Users

When using ContextGraph OS:

1. **Keep Updated**: Always use the latest version
2. **Validate Input**: Sanitize all external input before ingestion
3. **Secure Storage**: Protect the underlying storage layer
4. **Access Control**: Use the actor/authority model appropriately
5. **Policy Review**: Regularly audit your policy configurations
6. **Monitor**: Use the audit and query capabilities for security monitoring

## Disclosure Policy

We follow responsible disclosure:

1. Reporter submits vulnerability
2. We confirm receipt and begin investigation
3. We develop and test a fix
4. We release the fix
5. We publicly disclose the vulnerability (coordinated with reporter)

## Recognition

We appreciate security researchers who help keep ContextGraph OS secure. With your permission, we will acknowledge your contribution in our release notes.

## Contact

For security matters, please use GitHub's private vulnerability reporting.
