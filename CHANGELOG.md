# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial project structure with TypeScript configuration
- GitHub Actions CI/CD pipelines (CI, Release, CodeQL, Dependabot auto-merge)
- Issue and PR templates
- Core type definitions for EPIC 0 (System Foundations)
  - Base node schema with immutable, versioned nodes
  - Edge types with semantic relationships
  - Content-addressable identity system
  - Event-sourced append-only storage contract
- Graph module scaffolding for EPIC 1 (Context Graph Engine)
- Basic project documentation

### Security
- CodeQL security analysis enabled
- Dependency vulnerability scanning
- Secret scanning enabled
- License compliance checking

## [0.1.0] - Unreleased

Initial release - Coming soon.

[Unreleased]: https://github.com/akz4ol/contextgraph-os-core/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/akz4ol/contextgraph-os-core/releases/tag/v0.1.0
