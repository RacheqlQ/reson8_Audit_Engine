# Sonic DNA analysis and reconciliation contract

Status: implementation contract; this document does not claim that any analyser is installed, callable, or validated in production.

## Commercial-use boundary

- Do not add Essentia or Essentia-provided pretrained models to the production runtime until the applicable commercial licence and all algorithm-level third-party dependency rights are documented and approved.
- Essentia's published licensing page identifies AGPLv3 for non-commercial use and a proprietary licence on request; its pretrained models have separate non-commercial licensing terms. See https://essentia.upf.edu/licensing_information.html.
- Beat This! code and published model weights are MIT-licensed upstream. Any vendored, converted, quantized, or ONNX artifact must retain notices and have its exact source/checkpoint/conversion provenance recorded. See https://github.com/CPJKU/beat_this.
- A library's code licence does not automatically license datasets, training recordings, or unrelated model weights.

## Required evidence record

Every analyser result must be stored independently with:
- attribute and value (or explicit abstention);
- analyser name, exact version, model/checkpoint identifier and inference/runtime version;
- source audio content hash, sample rate, channel count, duration and analysis window;
- units and method;
- raw confidence/score, calibrated status (only if calibration has been evaluated), and explicit limitation/abstention reason;
- processing timestamp and reproducible configuration.

Do not convert a raw score into a probability or call it accuracy without a documented calibration evaluation.

## Attribute requirements

### Tempo and beat grid
Run the existing transient-autocorrelation estimator and an independently licensed neural beat tracker. Preserve each result, beat timestamps, alternate half/double-time candidates, segment stability and disagreement. A consensus BPM is reportable only when independent estimates agree within a documented tolerance and the acceptance benchmark supports the chosen gate. Beat/downbeat grid confidence is separate from BPM confidence.

### Key and mode
Run independent tonal estimators with tuning correction and segment-level outputs. Preserve key, mode, tuning offset, confidence and segment agreement separately. Report a key only when independent methods and segment stability agree under benchmarked gates. Otherwise report the candidates and abstention reason, not a guessed key.

### Loudness and dynamics
Use a standards-conformant EBU R128 / ITU-R BS.1770 measurement implementation for integrated loudness (LUFS), loudness range (LU), and true peak (dBTP/dBFS as defined by the implementation). Keep RMS level and RMS-envelope spread as separately named signal descriptors. Never label RMS-envelope spread as EBU loudness range or imply these quantities are interchangeable.

### Multi-feature acoustic signal profile
Compute reproducible, overlapping PCM windows from the uploaded master and retain robust median, 10th-percentile and 90th-percentile summaries. The profile includes RMS level (dBFS), peak level (dBFS), crest factor (dB), spectral centroid/bandwidth/85% rolloff (Hz), spectral flatness, positive spectral flux, zero-crossing rate, and low/mid/high frequency-band power ratios. Preserve the exact source SHA-256, source sample rate, channel count, duration, analysis sample rate, downmix rule, window/hop sizes, window coverage, aggregation rule, feature version, algorithm identity and measurement timestamp. Window count must be bounded without losing coverage of the beginning or end of long recordings.

These measurements are signal descriptors only. They are not a perceptual energy score, mood tag, mastering verdict or audience-response prediction. Keep descriptor provenance and units visible in the report. A missing/short/silent/invalid source must produce explicit abstention rather than zero-valued claims.

### Mood and musical context
Keep signal descriptors (RMS, spectral centroid, zero-crossing rate, band energy and related measurements) separate from mood and energy predictions. Do not present any single descriptor as a mood label or perceptual energy measurement.

When a validated, licensed model is not configured, the engine may still expose explicitly provisional estimates from uploaded-master PCM using the deterministic `audio_feature_heuristics_v1` method. Each provisional result must carry a 0–100 score, feature-driver provenance, `status: provisional`, and `probability: null`; the report must identify it as a heuristic, not a learned-model output or validated perceptual label. Insufficient or invalid audio must abstain rather than fabricate an estimate.

Calibrated mood/context claims require an identified model and licensed weights, a documented label taxonomy, per-label scores, model/version provenance, and a rights-cleared held-out evaluation set appropriate to the intended music domain, including per-label precision/recall/F1 and calibration evidence.

### Recording identity and ISRC\nExtract embedded identifiers only from supported, structurally valid audio metadata containers. Normalize ISRCs to uppercase without separators and validate the 12-character structure before lookup or reconciliation. A malformed identifier is not a weak match: ignore it as an identifier, preserve its source diagnostic where available, and continue checking lower-priority independent sources. Never let a malformed high-priority claim suppress a valid ISRC from another source.\n\nResolve valid ISRCs through authorized recognition/catalogue providers, retain each provider outcome (recognized, partial, unavailable, not configured), and preserve candidate ambiguity. Reconcile title, artist, release, label and ISRC independently. Multiple MusicBrainz recording or release candidates must not be silently collapsed into one identity. Keep provider commercial-use and retention status separate from operational enablement; a successful API call is not evidence of commercial permission.\n\n### Genre and DSP context
Keep provider metadata, audio-model classifications, embedded tags, and analyst inference in separate evidence lanes. Record each provider's exact field and source. Conflicting provider values remain visible as conflicts; do not silently choose one. Provider authorization in a registry is not evidence that an integration is implemented or was called.

## Reconciliation and report requirements

1. Persist successful and failed analyser attempts before reconciliation, including timeouts and unavailable-model states.
2. Reconcile each attribute independently; never let a genre or identity match fill missing tempo, key, mood, or loudness.
3. Preserve source-level candidates and conflicts. A consensus requires independent evidence and an explicit, tested policy.
4. Keep OBSERVED for measurements directly computed from the submitted master, RECOGNIZED for external source results, RECONCILED only for genuinely cross-checked agreement, and INFERRED for hypotheses.
5. The report must always show Tempo, Key/Mode, Mood, Integrated LUFS, LRA, True Peak, RMS and Context rows for a submitted master. Values may be unavailable, but each unavailable value must state why and identify the analyser status.
6. AI-generated narrative and scorecards must be sanitized against the final reconciled record. No unsupported BPM, key/mode, mood, genre, or loudness claim may survive into prose, charts, scorecards, or evidence ledger.
7. Correctly distinguish LUFS, LU, dBFS and dBTP units throughout the PDF.

## Acceptance gates (all required before production deployment)

- Deterministic fixtures: click track, tempo sweeps, half/double-time ambiguity, swung rhythm, syncopation, silence, noise, clipped audio and mixed genres.
- Tonal fixtures: synthetic major/minor keys, detuned instruments, modulations, atonal/percussive audio, silence and segment changes.
- Loudness fixtures: known EBU R128 reference files, true-peak inter-sample cases, silence, mono/stereo and variable dynamics.
- Mood/context evaluation: held-out, human-labelled multi-genre dataset; per-label precision/recall/F1 and calibration; document dataset rights.
- Cross-analyser reconciliation tests: agreement, disagreement, missing analyser, timeout, malformed output, low confidence and stale result.
- Report regression tests: every metric visible, correct units, provenance, abstentions and no unsupported narrative claims.
- Run the full test suite, TypeScript build, five independent acceptance passes, sample PDF generation and PDF text/layout inspection. Production deployment remains a separate approval gate.

## Current implementation warning

The current Node path uses a first-party transient-autocorrelation tempo estimator and FFT/harmonic-chroma key candidate estimator. Reporting gates are 0.50 for tempo confidence and 0.80 for key confidence plus 0.80 segment agreement; these are conservative product gates, not calibrated accuracy probabilities. Key-estimator candidate-retention floors are intentionally separate and lower so provisional alternatives remain available for review. The current implementation has no validated mood model: it may emit explicitly provisional uploaded-master mood tags and energy estimates from `audio_feature_heuristics_v1`, but they are not calibrated predictions or validated perceptual labels. RMS, spectral centroid and zero-crossing rate remain signal descriptors, not mood labels. Independent beat/key analysers and benchmark calibration remain required before claiming confirmed accuracy.
