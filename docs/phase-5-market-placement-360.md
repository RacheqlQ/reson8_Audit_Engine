# Phase 5 — Layer-by-Layer Market Placement & 360° Modern Music Marketing Engine

## Objective

Reconcile verified metadata, the uploaded-master Sonic DNA profile, ensemble tempo/key evidence, provisional audio-derived mood/energy, and ISRC/DSP catalogue records into an executive market-placement strategy. The output is a decision-support layer, not a claim of playlist placement, audience demand, sync clearance or campaign success.

## Runtime and implementation constraints

- Keep execution in the existing Node.js/TypeScript worker and report pipeline.
- Reuse the existing DSP playlist discovery, genre taxonomy/fusion, audio decoder, acoustic feature profile and PDF renderer. Do not add dependencies or a second inference service.
- Use the actual uploaded master for all audio-derived hooks and measurements. A DSP-only audit must not receive master-derived hook timestamps.
- Preserve field-level source provenance and evidence classes: OBSERVED, RECOGNIZED, RECONCILED and INFERRED. Keep general rollout guidance explicitly separated as INDUSTRY PRACTICE.
- Keep payments disabled. No schema migration is planned for the initial strategy layer.

## Required outputs

### 1. DSP playlist targeting

- Reuse current Spotify and Apple Music catalogue search results.
- Rank candidate playlists using explainable match evidence: exact ISRC presence where fully inspected, reconciled genre/adjacent lanes, and source-attributed mood/acoustic similarity.
- Distinguish an existing ISRC presence from an outreach prospect.
- A playlist search result is a candidate only; it does not prove curator interest, editorial acceptance, placement or performance.
- Never invent playlists, curators, submission routes or contact details.

### 2. Geographic territory prioritisation

- Rank a territory only when provider-verified territory-level audience/performance telemetry is present with provider, metric, territory, scale/unit and retrieval timestamp.
- Genre taxonomy region/scene tags, artist nationality, language, DSP availability, global popularity and catalogue metadata are not territory-demand evidence.
- If no qualifying territory telemetry exists, return an explicit unavailable state and explain which data is missing. Do not substitute inferred regional demand.

### 3. Timestamped short-form hooks

- Derive candidate windows only from uploaded-master acoustic window summaries and onset/transient evidence.
- Return bounded start/end timestamps, the measured window(s), selection method and evidence references.
- Mark timestamps as estimated window-level candidates, not editorially approved hooks or guaranteed engagement.
- If no uploaded master or adequate window/onset evidence exists, abstain with a reason.

### 4. DJ / club / sync positioning

- DJ/club fit may use reliable ensemble tempo, tentative beat-grid diagnostics, key/mode and measured rhythm/energy evidence.
- Sync fit may use source-backed genre, provisional mood/energy and measured acoustic context to form a clearly labelled creative-fit hypothesis.
- Do not claim club demand, DJ support, sync opportunity, rights ownership, clearance, stems availability or placement without corresponding verified records.
- Rights and clearance must remain explicitly unverified unless a source-backed rights record is supplied.

### 5. Phased 360° rollout

- Produce pre-release, release-window and post-release actions linked to actual evidence and the preceding outputs.
- Separate track-specific INFERRED recommendations from general INDUSTRY PRACTICE.
- Do not fabricate audience segments, territory priorities, campaign budgets, conversion forecasts, stream targets or performance outcomes.
- When audience/territory telemetry is absent, mark paid-media and geo-targeting decisions as blocked pending verified data.

## Evidence and data contract

Every track-specific strategy item must include at least one stable evidence reference and an evidence class. Source-backed catalogue facts retain provider and retrieval time. Audio-derived items retain the uploaded-master hash/provenance and measurement method. Provisional mood/energy remains explicitly provisional and is never presented as a calibrated probability.

## Phase 5 implementation sequence

1. Add a pure, typed strategy builder and tests for evidence eligibility, ranking, abstention and timestamp bounds.
2. Extend acoustic window summaries with the already-computed spectral-flux/onset measure needed to select timestamped hook candidates.
3. Wire the strategy builder after identity/genre/catalogue reconciliation and playlist discovery in the existing worker.
4. Render a dedicated Market Placement & 360° Strategy report section, preserving source links, evidence classes, retrieval times and limitations.
5. Add integration and PDF regression tests; run focused tests, full CI/build and five acceptance passes on one exact commit SHA.
6. Inspect generated sample/full reports and confirm payment remains disabled before merge/deploy.

## Explicitly deferred

- The user's live uploaded-master frontend test remains a separate real-world verification step; automated fixtures do not replace it.
- Territory ranking remains unavailable until genuine territory-level audience/performance telemetry is supplied by an authorized provider.
- Commercial distribution of MusicBrainz-derived data remains blocked until its commercial-use and retention permissions are confirmed.
