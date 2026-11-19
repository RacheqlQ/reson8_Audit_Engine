# Phase 1 — Real-master execution contract

## Runtime decision

The audit engine currently runs as a Node.js/TypeScript service. Phase 1 stays in that runtime and uses the existing worker, FFmpeg decoder, Sonic DNA worker client, metadata reconciliation and report generator. This avoids a second service, duplicated audio decoding and an additional deployment boundary. Python is reserved for offline model training/evaluation unless a separately approved inference service is justified later.

## Execution modes

- `master`: uploaded audio is mandatory; the job cannot complete without retrieving and decoding the actual uploaded object and persisting Sonic DNA.
- `combined`: both uploaded audio and submitted DSP/catalogue link are mandatory; neither source silently substitutes for the other.
- `dsp_link`: a metadata-only audit is permitted, but it must be labelled metadata-only and cannot claim Sonic DNA was measured from a master.

Synthetic fixtures are permitted only in tests and report-rendering workflows. They must never be accepted by the production master worker.

## Master admission gate

Before metadata tags, recognition or decoding are processed, the worker validates:
1. source kind is `uploaded_master`;
2. storage path is present;
3. downloaded byte array is non-empty;
4. MIME type is present and supported by the contract;
5. SHA-256 is computed over the exact bytes downloaded for this job.

The digest is tied to the downloaded master, not inferred from a filename, DSP URL or synthetic fixture. A failed gate fails the master audit; it does not downgrade to a DSP-only audit.

## Contract domains

The executable Zod contract is `src/audio/real-master-contract.ts`.

- `directSignalMeasurements`: numeric measurements with unit, method, timestamp and diagnostic list; unavailable measurements require a null value and at least one diagnostic.
- `calibratedPredictions`: predictions require a bounded probability, model version, calibration method, validation dataset/sample count, ECE, Brier score and feature drivers. Unavailable predictions require reason codes and diagnostics.
- `externalRecords`: verified records require provider, provider record ID, retrieval timestamp and field-level provenance. Failed/unavailable lookups are represented as explicit provider outcomes.
- `strategicSynthesis`: every claim must cite one or more evidence references in the contract. Claims are labelled OBSERVED, RECOGNIZED, RECONCILED or INFERRED.

The contract deliberately does not invent predictions to eliminate abstention. A model that has not yet been trained and calibrated cannot truthfully emit a calibrated probability. Phase 1 therefore provides the structured unavailable state; Phase 3 will supply calibrated mood predictions after model validation.

## Required downstream behaviour

- Never interpret a missing number as zero.
- Never render the literal strings `N/D`, `Not performed` or `unknown` as the sole explanation for a missing measurement.
- Preserve reason codes, diagnostic messages, method and source provenance into the report.
- Do not convert signal descriptors (RMS, centroid, ZCR, etc.) into emotional labels.
- Catalogue presence or an ISRC match is identity/release evidence, not proof of streams, listeners, revenue, playlist adds or audience demand.
- Do not describe a metadata-only job as a real-master audit.
- Keep MusicBrainz enabled and payment processing disabled.

## Phase 1 exit criteria

1. Empty, missing and synthetic master inputs fail closed.
2. A real uploaded master is hashed and decoded before Sonic DNA can be persisted.
3. The contract validates all four evidence domains and rejects uncalibrated probabilities or unsupported synthesis claims.
4. Every unavailable value has structured diagnostics.
5. Existing DSP-only audits remain metadata-only and cannot masquerade as master analysis.
6. CI passes, then a real uploaded-master audit is run and its generated report is inspected before merge/deploy.

## Current limitation

This phase introduces the contract and the first strict worker admission gate. It does not implement the Phase 2 tempo/key ensemble, Phase 3 mood model, or Phase 4 expanded ISRC extraction. Until those phases are approved and completed, the engine must preserve explicit unavailable states rather than fabricate model output.
