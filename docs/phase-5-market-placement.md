# Phase 5 — Evidence-led market placement and 360° rollout

## Purpose

Phase 5 turns the existing verified/reconciled metadata, uploaded-master Sonic DNA, tempo/key ensemble diagnostics, provisional acoustic mood/energy estimates, and ISRC/DSP catalogue outcomes into a structured executive strategy. It does not replace the source evidence or promote recommendations into observations.

The implementation remains in the existing Node.js/TypeScript worker and report pipeline. It adds no runtime dependency.

## Strategy outputs

### DSP playlist targeting

Only playlist candidates returned by configured Spotify or Apple Music catalogue discovery are eligible. Exact ISRC presence is ranked above genre/mood similarity. The numeric priority is a deterministic shortlist-ordering aid, not a probability or a claim of editorial fit. Provider, URL, retrieval timestamp, match basis and membership uncertainty are retained. A Spotify search result is not treated as an inspected playlist membership record.

A candidate never proves curator interest, acceptance, placement, reach, streams or commercial performance. The current playlist endpoints do not expose candidate-track BPM, key, energy and acoustic feature vectors, so a true track-to-playlist acoustic similarity score is unavailable. Genre/mood alignment is not relabelled as acoustic similarity.

The uploaded-master mood search may use existing audio_feature_heuristics_v1 labels when their status is provisional. These are heuristic tags, not a calibrated random-forest mood classifier or probability.

### Geographic territory priorities

Territories are ranked only when evidence.audienceTelemetry contains all of:

- verified: true
- a named provider and metric
- a non-empty reportingPeriod
- a valid ISO-8601 retrievedAt
- one or more territories entries with ISO 3166-1 alpha-2 countryCode and a finite, non-negative value

Values are sorted only within that single provider, metric and reporting period. The implementation does not combine different metrics, providers or time windows. If the contract is absent or incomplete, territory priorities are explicitly unavailable. Artist location, genre popularity, ISRC presence and playlist search are not substitutes for listener geography.

No audience-geography provider is currently wired into the audit worker, so an ordinary audit is expected to show the withheld state until verified telemetry is supplied.

### Timestamped short-form edit candidates

For uploaded-master audits only, the strategy ranks up to three 12-second excerpt candidates using the existing downsampled onset envelope and nearest windowed RMS context. The score is a relative signal-peak priority (0–100), not a probability, retention prediction or proof of a musical hook. The timestamp is a candidate edit location, not an automatic clip export.

A human must audition each excerpt, confirm musical/lyrical context, choose clean boundaries, and verify rights and asset approval before publication. Metadata-only audits cannot emit master-derived timestamps.

### DJ, club and sync positioning

DJ review requires confidence-qualified tempo and a tentative beat grid. Club review additionally requires a provisional audio-energy estimate. Both remain human-review recommendations; tempo and energy do not establish demand, mix compatibility, venue support or dancefloor response.

Sync outreach remains blocked unless rights status is explicitly verified as cleared and the master is marked approved. Even then, the output requests human review against an actual brief and chain-of-title; it does not assert sync suitability or grant clearance.

### 360° rollout

The plan separates pre-release, release-window and post-release actions. Each phase includes execution gates. It does not invent dates, budgets, audience targets, campaign performance or partner commitments. Post-release territory and performance decisions require platform-native or campaign analytics with provider attribution and a defined reporting window.

## Evidence and rights constraints

- OBSERVED, RECOGNIZED, RECONCILED and INFERRED remain distinct.
- Provisional mood/energy outputs remain explicitly provisional and carry no calibrated probability.
- Missing audience or territory evidence is shown as unavailable, not estimated.
- MusicBrainz-derived data remains evaluation-only for commercial distribution until commercial-use and retention permissions are confirmed.
- Payment remains disabled.
- Real uploaded-master frontend end-to-end verification remains a separate user-run acceptance step and is not claimed by automated tests.
