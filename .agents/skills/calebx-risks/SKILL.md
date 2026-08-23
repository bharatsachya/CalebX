---
name: calebx-risks
description: CALEBX key risks and mitigations register (Telegram 429 cascade, HelixDB E622 type mismatch, persona drift, LLM hallucination, MinIO data loss, platform ban). Read when assessing operational/architectural risk or deciding mitigations for these failure modes.
user-invocable: false
metadata:
  internal: true
---

## Key Risks & Mitigations

| Risk                                  | Likelihood          | Impact                 | Mitigation                                                                   |
| ------------------------------------- | ------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| Telegram HTTP 429 cascade             | High (early dev)    | Service outage         | dispatch-queue concurrency=1, jitter, retry_after                            |
| HelixDB type mismatch (E622)          | Medium              | Dev time loss          | Always use `I64` for IDs, `helix compile` in CI                              |
| Persona drift (old chunks dominating) | Medium              | Bad recommendations    | `decay_weight` × recency score in RRF ranker                                 |
| LLM extraction hallucinating entities | Medium              | Junk in persona graph  | Low temperature (0.1) + JSON schema validation on extraction output          |
| MinIO data loss on restart            | Low (if configured) | All persona data wiped | Always use `--disk` flag. Never use in-memory in staging+                    |
| Telegram platform ban (ISP-level)     | Low                 | Full service loss      | Architect DB layer to be platform-agnostic; Discord adapter ready in Phase 5 |
