# Contributing to ContextGraph OS

Thank you for your interest in contributing to ContextGraph OS! This document provides guidelines and information for contributors.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## How to Contribute

### Reporting Issues

- Check existing issues to avoid duplicates
- Use the issue templates provided
- Include as much detail as possible
- For security issues, see [SECURITY.md](./SECURITY.md)

### Submitting Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Install dependencies**: `npm install`
3. **Make your changes** following our coding standards
4. **Add tests** for any new functionality
5. **Run the test suite**: `npm test`
6. **Run linting**: `npm run lint`
7. **Run type checking**: `npm run typecheck`
8. **Submit a pull request** using the PR template

### Development Workflow

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/contextgraph-os.git
cd contextgraph-os

# Add upstream remote
git remote add upstream https://github.com/akz4ol/contextgraph-os.git

# Create a feature branch
git checkout -b feature/your-feature-name

# Install dependencies
npm install

# Make changes and test
npm test
npm run lint
npm run typecheck

# Commit with conventional commits
git commit -m "feat: add new feature"

# Push to your fork
git push origin feature/your-feature-name
```

### Commit Message Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation only
- `style:` Code style changes (formatting, semicolons, etc.)
- `refactor:` Code refactoring
- `perf:` Performance improvements
- `test:` Adding or updating tests
- `chore:` Maintenance tasks
- `ci:` CI/CD changes

Examples:
```
feat: add temporal validity to node queries
fix: prevent orphaned nodes during edge deletion
docs: update API reference for Policy engine
refactor: simplify decision commitment logic
```

### Coding Standards

- **TypeScript**: Use strict mode, explicit return types
- **Formatting**: Prettier with project settings
- **Linting**: ESLint with project rules
- **Testing**: Jest with high coverage
- **Documentation**: JSDoc comments for public APIs

### Testing Requirements

- Unit tests for all new functions
- Integration tests for cross-module features
- Maintain 80%+ code coverage
- Tests must pass in Node.js 18, 20, and 22

### Pull Request Checklist

- [ ] Code follows project style guidelines
- [ ] All tests pass
- [ ] New tests added for new functionality
- [ ] Documentation updated if needed
- [ ] No new TypeScript errors or warnings
- [ ] Commit messages follow conventional commits
- [ ] PR description explains the changes

## Project Structure

```
src/
├── core/           # System foundations (types, storage, identity)
├── graph/          # Context Graph Engine
├── provenance/     # Provenance & Lineage Engine
├── policy/         # Policy Evaluation Engine
├── decision/       # Decision Commitment Protocol
├── actor/          # Actor & Authority Model
├── hitl/           # Human-in-the-Loop Controls
├── query/          # Query, Replay & Audit Engine
├── sdk/            # Agent SDK
└── safety/         # Failure Handling & Safety
```

## Getting Help

- Open a [Discussion](https://github.com/akz4ol/contextgraph-os/discussions)
- Check existing issues and discussions
- Read the documentation

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.
