# Vocal-band and arrangement analysis — signal evidence boundaries

## In-process PCM path

The production audit pipeline derives vocal-band and arrangement descriptors directly from the decoded uploaded master. It does not invoke Demucs, Spleeter, Open-Unmix, an ONNX separation model, an external vocal worker, or an external PDF-render worker.

The zero-cost path is implemented in `src/audio/vocal-arrangement-analysis.ts` and is called by the existing Sonic DNA PCM analysis:

- Bounded mono PCM is processed in overlapping 2,048-sample Hann windows with a 1,024-sample hop.
- A radix-2 FFT estimates 250–3,500 Hz band-energy salience and spectral flatness/harmonicity.
- Vocal-band activity is a thresholded signal proxy, not a human-voice classifier.
- Candidate F0 is estimated with lightweight autocorrelation in the 70–500 Hz range on selected active windows. The median and 10th–90th percentile range are reported only when enough candidates exist.
- Contiguous active windows are merged into timestamped intervals.
- Arrangement transitions are inferred from spectral-flux novelty, RMS changes, chroma movement and vocal-band activity onset/offset.
- Section labels use deterministic position and repeated-section heuristics. They are always marked provisional.
- Work is bounded by the existing PCM analysis sample cap and a maximum of 512 pitch frames; no neural model weights are loaded.

The persisted Sonic DNA fields are `vocalArrangementAnalysis` and the compatible `vocalFeatures` projection. The report uses the same data in the Executive Summary, A&R questions, SWOT, SMART actions, arrangement guidance and human listening checks.

## What the measurements mean

- `vocalPresencePct` is the percentage of analysis windows that cross the configured 250–3,500 Hz salience and harmonicity thresholds. It is not a calibrated probability of human vocals.
- `vocalBandEnergyDbfs` is an estimated whole-master vocal-band RMS descriptor.
- `vocalMedianF0Hz` and `vocalF0RangeHz` are periodicity-derived F0 candidates from active windows, not validated singer pitches.
- `vocalActivityIntervals` are timestamps where the signal proxy is active.
- `inferredSections` and `detectedTransitions` are structural hypotheses, not verified musical form.

Periodic instruments, synths, guitars, bass harmonics and resonant percussion can satisfy similar thresholds. The system therefore does not assert that every active interval contains a human voice.

The report explicitly does not determine:

- Exact section labels or whether a section is a verse, pre-chorus, chorus, bridge or outro.
- Singing versus speech/rap; lead versus backing; singer/speaker count; doubles or choir count.
- Lyrics, language, intelligibility, delivery quality or emotional intent.
- Mix/master readiness, audience response or commercial performance.

Human listening is required to confirm or revise each timestamp, F0 candidate and section label. No stem is created or claimed.

## Runtime and deployment boundary

The queue worker calls the in-process Sonic DNA analysis and persists its result before A&R assessment and PDF generation. The optional `ENABLE_VOCAL_ANALYSIS` stem-separation hook has been removed from the production worker dependency path. Legacy separation modules and package entries are not invoked by this pipeline.

The report continues to use the existing PDF renderer and the existing Full/Sample page allocations. No additional page, external render service, database migration, Render configuration change or secret change is required by this implementation.

## Verification

Unit tests cover F0 candidate tracking, vocal activity interval merging, structural transition segmentation, low-signal abstention and report layout/page-count preservation. CI must also run the full suite, TypeScript build, sample report generation and the five acceptance passes.

A real uploaded master is required for final signal-quality review. The recorded Phillo master is:
- Audit: `503069b9-3f2c-40c0-af8b-8c0540a7e4ab`
- File: `Phillo - Stunixx.mp3`
- Duration: 192.048 seconds
- SHA-256: `fdc5d99c701e44063b31d512dbab29929a24ca9f1044dc1484f91d16715c89a4`

The source object remains in the private `audit-audio` bucket. This document does not claim that the new code has already been run against that object. Production deployment remains separate and requires explicit authorization.

## Evidence status

- In-process vocal-band and F0 candidate extraction: implemented; CI and synthetic signal tests pending for this revision.
- In-process arrangement boundary/transition hypotheses: implemented; CI and synthetic signal tests pending for this revision.
- Human vocal classification, source separation and calibrated vocal-presence accuracy: not implemented.
- Human review of Phillo timestamps/labels: pending.
- Production deployment: not performed.
