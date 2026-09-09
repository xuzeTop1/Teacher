# Security and Correctness Remediation — 2026-08-01

This record closes the actionable findings from the 2026-08-01 reverse audit.

## Implemented

- Code execution remains fail-closed in Release and requires two explicit Debug opt-ins. Its documentation now states that Python guardrails are not a sandbox.
- Timeout cleanup now terminates the complete worker process tree, joins output readers, and budgets one timeout per requested test case. Python wrapper source is passed through a temporary file instead of command-line `-c`.
- Sidecar integrity uses stable runtime manifest names and a manifest colocated with development sidecars; malformed or absent manifests fail closed unless the documented Debug-only integrity opt-in is present.
- Worker input schema is type checked, test output and diagnostics are bounded and sanitized, and test runtime errors retain their diagnostic.
- Provider streaming has a 1 MiB incomplete-SSE-line limit and a five-minute bounded stream timeout for reasoning models. Provider keys remain bound to the normalized endpoint, and deleting a provider removes its keychain entry.
- Embedding delay is clamped to 0–10 seconds with overflow-safe retry delay; batch index, count, and numeric-vector validation reject misaligned responses.
- Math expressions have length, parenthesis-depth, and balance validation before recursive evaluation.
- Streaming tutor metadata is persisted after final planner/guardrail/tool fields exist. Private-document nodes are filtered at both TypeScript and Rust assessment boundaries, and approved knowledge nodes cannot be overwritten by assessment snapshots.
- Guardrails cover numeric Chinese direct-answer wording and numbered solution sequences. Mastery inference treats “算不出来” as unknown, answer comparison rejects negated/substring answers, failed practice persistence does not mutate UI mastery, recent-question exclusion is active, and chapter readiness uses the same 0.8 completion threshold.
- Prompt-injected retrieval/tool content is explicitly marked untrusted. External search links allow only HTTP(S), user-visible error messages are path/key sanitized, CSP includes `base-uri 'none'`, and SQLite connections use a five-second busy timeout.

## Explicit remaining boundary

An OS-level sandbox with enforceable memory, file-system, process, and network limits is still not implemented (see open decision D-112). It is not exposed as a working capability: untrusted execution stays disabled, and `memoryLimitMb` is rejected rather than silently accepted.

## Required verification

Run `npm run test -- --run`, `npm run build`, `cargo test` from `src-tauri`, and `python -m pytest tools/code-worker/tests -q`. Rebuild the installer before any distribution, because the existing installer predates these source changes.
