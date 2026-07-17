# Security Policy

stratless has one core promise: your conversation history is read on your machine and nothing
leaves it. This policy defines a vulnerability as anything that breaks that promise, or the trust
around it.

## What counts as a vulnerability

- Any path by which stratless sends data off the machine, to anyone, for any reason.
- Any way transcript content (untrusted input that stratless parses) can drive code execution,
  shell behavior, or file writes it should not.
- The borrowed `claude` doing anything beyond reading and answering: writing files, running
  tools, or otherwise acting on your environment.
- Writes escaping `~/.stratless` or the managed markers in `~/.claude/CLAUDE.md`.
- Anything that makes the package published on npm differ from this source.

If you are unsure whether something qualifies, report it privately anyway. A false alarm read in
private beats a real issue missed in public.

## How to report

Use GitHub's private reporting: the Security tab of this repository, then "Report a
vulnerability". This opens a private advisory that only maintainers can see.

Please do not open a public issue for a suspected vulnerability.

## What to expect

stratless is maintained by one person. Honest terms:

- Acknowledgment within 7 days.
- A fix, or a coordinated public advisory, as fast as severity demands.
- Supported version: the latest release only (the project is pre-1.0).

## Integrity of releases

Every release is published to npm over Trusted Publishing (OIDC, no long-lived token) with
Sigstore provenance binding the tarball to this repository, commit, and workflow run. You can
verify any installed copy with `npm audit signatures`.
