# Vocal intelligence — evidence and runtime boundaries

## Current implementation

The Node audio pipeline now runs a bounded, deterministic periodicity diagnostic over the decoded master PCM. It samples up to 512 frames and estimates autocorrelation peaks in a 70–500 Hz range. The output includes sampled-frame count, periodic-frame count, an activity ratio and pitch-frequency candidates.

This is a signal diagnostic only. It does not establish that the periodic source is a human voice. Bass instruments, synthesizers and other harmonic sources can produce similar measurements. The result is therefore stored as `signal_diagnostics_only`, with `voicePresence: undetermined`, and is not accepted by the report guardrail as completed vocal analysis.

## Not implemented by this change

- Vocal/instrumental source separation (for example, Demucs).
- A validated vocal-presence classifier.
- Speech activity detection or singing-versus-speech classification.
- Speaker count, lead/backing/choir classification or diarization.
- Lyric transcription, articulation or language detection.
- Calibrated vocal-stem quality, leakage or separation metrics.

These capabilities require a model-serving runtime with pinned model artifacts, model provenance, resource limits, and independent labelled evaluation. The current production service is Node-only; adding Python/PyTorch packages to `package.json` would not execute those models. A separate worker service or an explicitly provisioned container runtime is required.

## Report policy

Reports may show periodicity diagnostics, but must state that vocal presence, singing, speech and vocal arrangement remain undetermined. DSP metadata and audio periodicity must never be used to claim that a track is instrumental or vocal-led. Curator targeting remains blocked until a validated vocal-analysis result and human listening review are available.

## Model and licensing gate

Before enabling source separation or classifier inference, pin exact code and model-weight versions, record their licences and training-data provenance, measure CPU/RAM/runtime on representative masters, and evaluate against labelled reference audio. The Demucs code licence does not by itself establish commercial-use rights for every published model weight. No model weights are downloaded or run by this change.

## Evidence status

- Deterministic periodicity diagnostics: implemented in the Node analysis path; CI verification pending.
- Human-vocal detection and separation: not implemented / not configured.
- Real-master vocal accuracy: unvalidated; requires a labelled reference set.
- Production deployment: not performed.