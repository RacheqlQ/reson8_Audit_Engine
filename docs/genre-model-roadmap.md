# Genre model readiness roadmap

## Current operating mode

The classification path is deterministic and evidence-led: versioned taxonomy aliases, weighted provider-tag fusion, and a tempo prior capped at 15%. It does not train or invoke a neural model.

`DEFAULT_GENRE_MODEL` is a `NullGenreModel` and returns `status: disabled`. No model weights, embeddings, training pipeline, or inference dependency are included.

## Gates before any learned model

1. Define a rights-cleared, representative dataset with source provenance and opt-in terms.
2. Record train/validation/test splits by artist and release to prevent leakage.
3. Establish genre-level precision, recall, macro-F1, calibration, abstention, and regional coverage baselines.
4. Audit every candidate model, tokenizer, training corpus, and derived dataset licence.
5. Verify commercial-use, redistribution, attribution, and model-weight obligations with legal review.
6. Compare against the deterministic provider-evidence baseline and retain an abstention path.
7. Require explicit feature enablement, privacy review, and a rollback plan before deployment.

## Licence status

**UNVERIFIED.** No learned model or training dataset has been selected. Licence compatibility must not be assumed. CC BY-NC and AGPL sources remain excluded under the project constraints.

## Data handling

No raw audio, artist identity, track identity, or personal data may be used as model-training capture. The optional feature-capture switch is off by default and, when explicitly enabled, is limited to compact derived feature metadata in the existing `audit_events` payload. It does not write a new table or schema.