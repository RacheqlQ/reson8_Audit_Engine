# Vocal analysis — evidence and runtime boundaries

## Implemented acoustic path

For an uploaded master, the existing Node worker now runs a vocal-only source-separation model against the decoded PCM before Sonic DNA is persisted and before metadata reconciliation is written.

- **Model:** Open-Unmix UMX-HQ vocals ONNX, exported from the published UMX-HQ vocals weights.
- **Artifact:** `MixDirective/open-unmix-umxhq-vocals-onnx/model.onnx`
- **Expected size:** 35,623,512 bytes.
- **Pinned SHA-256:** `f27742bb52b24cb039614dc76d0764e279df3eb2a9d6daa82c6daee3369ec747`. The runtime refuses an artifact with a different size or hash.
- **Runtime:** Node ONNX Runtime CPU, with a 20-second inference chunk and 2-second overlap. The model input is resampled to 44.1 kHz stereo and returned at the decoded master's sample rate.
- **Memory policy:** CPU memory arena and memory pattern pooling are disabled; the vocal-only path uses one multichannel Wiener refinement iteration with 120-frame windows to balance reconstruction quality and peak allocation on the existing Render worker. Actual production RAM and latency still require measurement against real masters.
- **Cache:** the verified model is stored under `AUDIO_NEURAL_CACHE` or `~/.cache/audiojs/neural`; no model weights are committed to the repository.

The result records model provenance, vocal-stem energy ratio, estimated activity ratio and timestamps, vocal-stem RMS, a conservative fundamental-frequency range/contour, and explicit limitations. The result is persisted as part of Sonic DNA before reconciliation.

## What the result means

`voicePresence` is one of `likely_present`, `not_detected`, or `uncertain`. It is a conservative interpretation of a separated stem plus energy and periodic-pitch evidence. It is **not a calibrated probability or a proof** that a human voice is present or absent. Harmonic instruments can leak into the vocal stem; some vocal material can be suppressed by source separation.

The report deliberately does not claim capabilities this model path does not provide:

- Singing versus speech/rap is not classified.
- Lead versus backing vocals, doubles, choir count, speaker count and diarization are not classified.
- Vocal effects, intelligibility, language and lyric content are not analysed.
- No lyric transcription is requested or generated.
- The model's estimated vocal stem is not a substitute for a human listening review.

Automated results carry `reviewStatus: not_human_reviewed`. Curator targeting remains gated until vocal evidence has been human-reviewed; a machine-generated stem estimate alone does not qualify a track for a vocal-specific curator pitch.

## Model and package licensing

The ONNX package and the UMX-HQ vocals artifact identify their code/weights as MIT-licensed. The artifact is hash-pinned at runtime. This does not grant rights to the submitted recording or clear every possible use of source-separated audio; users remain responsible for having rights to the uploaded master and any downstream use. Re-check the upstream model card and notices before changing the artifact or model revision.

Implementation dependencies are pinned in `package.json` and `package-lock.json`: `@audio/neural-separate@0.7.1`, `@audio/neural-runtime@0.2.1`, and `onnxruntime-node@1.31.1`. The selected ONNX Runtime version and its resolved dependency tree were checked for known advisories; no known vulnerabilities were returned for the pinned tree. Its native runtime installation script is still a lifecycle-script risk surface and is not treated as risk-free.

## Verification required before production acceptance

- Unit tests cover activity intervals, pitch estimation, abstention, the actual separation pipeline with a deterministic ONNX session double, report rendering, and the evidence-chain ordering.
- Pre-merge CI passed install, the full test suite, TypeScript build and sample-report inspection on feature head `10f8b570f1f2b341ff346e9f751e6bc014029be3`.
- All five pre-merge acceptance passes completed successfully on that same feature head. Post-merge main-branch workflows are tracked separately.
- A real submitted master must be analysed to inspect stem leakage, false vocal activity, timestamps and pitch output. No such real-master validation is claimed by synthetic tests.
- Render CPU/RAM, cold model download time, warm-cache inference time and timeout behaviour must be measured before deployment. Do not change Render plans, environment variables, Supabase or the separate worker as part of this feature.

## Evidence status

- Acoustic vocal-stem extraction and measurements: merged in main at `ab0f9f564c50c05e9c4e8d371a8866a8d67b5942`; pre-merge CI and all five acceptance passes passed. Real-master validation remains pending.
- Human review and calibrated vocal-presence accuracy: not implemented.
- Singing/speech/rap and lead/backing classification: not implemented.
- Production deployment: not performed.

## Queue-worker integration

The production queue worker exposes the existing isolated vocal-analysis worker through the
`ENABLE_VOCAL_ANALYSIS=true` feature gate. The default remains off because model inference
adds CPU and resident-memory pressure on the Render worker. When the flag is off, the audit
records vocal analysis as unavailable rather than inferring vocal presence or delivery.

Do not enable this flag in production until a real-master run has recorded peak RSS, elapsed
time, timeout behavior, and successful persistence of the final vocal result. No production
environment setting is changed by this code change.

Track-structure and section-boundary analysis is not implemented in the current Node.js
pipeline. Reports must explicitly abstain from verse/chorus/bridge claims until a separately
validated section-segmentation stage is implemented and evaluated.
