# Zero-cost audio detector evaluation

## Current phase

This phase evaluates the existing in-house TypeScript audio-analysis pathways using deterministic synthetic fixtures. It does not add a Python runtime, install Essentia, madmom, Beat This!, PyTorch, torchaudio, or download model checkpoints.

The harness exercises:
- transient-autocorrelation tempo estimation against a generated 120 BPM pulse train;
- independent low-frequency-envelope tempo estimation on the same fixture;
- FFT/chroma key estimation against a generated A-minor harmonic fixture;
- independent Goertzel key estimation on the same fixture;
- abstention behavior on silence.

CI writes `artifacts/audio-detector-evaluation.json`. The artifact records the expected fixture values, actual detector outputs, confidence/score diagnostics, abstention reasons, and errors where a numeric estimate is available.

## Interpretation limits

- Synthetic fixtures validate execution, deterministic diagnostics, and known-input behavior only.
- They do not establish real-world accuracy, superiority over other detectors, or performance on commercial masters.
- An abstention is retained as an outcome; the harness does not force a detector to return a label.
- Synthetic fixture values must not be presented as user-track measurements or commercial evidence.
- No synthetic result is added to a customer's report or persisted as a track assessment.

## Third-party candidates

Essentia, madmom, and Beat This! remain uninstalled and disabled. This zero-cost phase does not exercise their code or weights. Their use requires separate dependency/artifact/license review and a measured resource assessment. Essentia and madmom model/data restrictions remain in force. Beat This! evaluation may be reconsidered only after its exact checkpoint, dependencies, data rights, and memory requirements are reviewed.

## Cost and production boundary

The harness runs inside the existing CI job and uses the repository's current Node.js dependencies. It adds no hosted worker, Render service, Render configuration, production dependency, model download, database migration, environment variable, or payment integration. It is not run by the production worker and does not change report-generation behavior.
