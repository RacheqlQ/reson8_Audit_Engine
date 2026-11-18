# Data and licence policy

**Status:** provider authorization is registry-driven; no per-provider environment enable switches are used.
**Last reviewed:** 2026-11-18
**Scope:** Reson8 Audit Engine and its embedded worker.
**Legal note:** This is an engineering control, not legal advice or a representation that a vendor has granted rights. Use every source only within its current API terms, licence, contract, territory and data-handling obligations.

## Operating rules

1. Use submitter-supplied audio and metadata only for the requested audit, subject to the submitter's authority to provide them. Do not train models on submitted masters.
2. Prefer first-party analysis implemented in this repository. Record algorithm/model, version, inputs, confidence tier and limitations for every audio-derived claim.
3. The executable status in `src/providers/provider-policy.ts` is authoritative. `allowed` means operationally authorized for this product's workflow; it does not waive provider terms, require no contract, or prove commercial rights beyond those terms.
4. An approved provider is called when its integration is implemented and its actual credentials/configuration are present. No `PROVIDER_ENABLED_<NAME>` switches are required. Missing credentials/configuration are reported as `not_configured`; unverified or denied providers are blocked with `disabled by data policy`.
5. Never silently substitute fabricated or stale values. Reports identify data sources and methods, distinguish submitter-supplied/unverified information from provider observations and measured analysis, and include retrieval timestamps where applicable.
6. Do not retain third-party audio or provider payloads beyond the documented operational need. Diagnostic events contain derived features only: a normalized onset envelope capped at 128 values, beat markers capped at 512, heuristic four-beat downbeat candidates capped at 128, and up to 12 normalized 12-bin chroma segments. Never store PCM samples, audio bytes, access tokens or reconstructable audio in diagnostics.
7. Payment controls are separate from data-provider controls. `PAYMENTS_ENABLED` remains false by default and must not be enabled as part of this policy work.

## Commercial status register

| Source / component | Intended use | Status | Runtime / use condition |
|---|---|---|---|
| Submitter-supplied audio and metadata | Requested audio analysis and catalogue context | allowed | Submitted job only; submitter must have authority; no model training on masters. |
| Reson8 first-party DSP algorithms | Onset, tempo candidates, chroma/key estimates, signal diagnostics | allowed | Internal implementation; disclose method and confidence; do not claim a model/measurement that was not run. |
| Groq | LLM assessment processing | allowed | Requires `GROQ_API` or `GROQ_API_KEY`; comply with current Groq API terms, data-use, retention and deletion requirements. |
| Gemini | LLM assessment fallback | allowed | Requires `GEMINI_API_KEY`; comply with Google AI terms and data handling. |
| Ollama Cloud | LLM assessment fallback | allowed | Requires `OLLAMA_API_KEY`; use hosted cloud API only from the embedded worker; comply with applicable terms. |
| AudD | Recording identification / metadata | allowed | Requires `AUDD_API` or `AUDD_API_TOKEN`; comply with audio-processing, retention and deletion requirements. |
| Spotify | Catalogue metadata cross-reference | allowed | Requires Spotify client credentials; follow API terms, display, refresh and deletion requirements. |
| Apple Music / iTunes lookup | Catalogue metadata cross-reference | allowed | Public lookup integration; follow applicable Apple terms, attribution and caching requirements. |
| YouTube Music oEmbed | Submitter-linked music metadata | allowed | Use only supported oEmbed metadata; comply with YouTube terms and attribution. |
| TIDAL | Catalogue metadata cross-reference | allowed | Requires TIDAL client credentials; comply with current API terms and data handling requirements. |
| Audiomack Data API | Catalogue metadata cross-reference | allowed | Requires OAuth client credentials; use only the official signed Data API; no scraping or playback metrics; comply with applicable commercial permissions. |
| MusicBrainz | Release/recording identifiers and public catalogue metadata | allowed | Descriptive User-Agent containing `MUSICBRAINZ_CONTACT`; maximum 1 request/second; attribution required. |
| ListenBrainz | Public listening/artist context where available | allowed | Respect API limits and attribution; do not infer market share from incomplete observations. |
| YouTube Data API | Submitter-linked channel/video metadata and permitted public metrics | allowed | Requires `YOUTUBE_API_KEY`; follow API Services Terms, Developer Policies, attribution and refresh/deletion rules. |
| Last.fm | Catalogue/listening metadata | allowed | Requires valid Last.fm API credentials; comply with API terms, attribution, caching and deletion requirements. |
| Chartmetric / Soundcharts / Luminate | Paid market intelligence | allowed, contract-dependent | Call only when the applicable executed commercial agreement and approved credentials exist; follow contract-specific attribution, storage and deletion clauses. |
| Deezer | Catalogue metadata | unverified | Do not call until current API/commercial permissions for this product are verified. |
| Beat This! | Optional tempo/beat inference | unverified | Do not enable until exact model artifact, commit, SHA-256, licence, conversion provenance, training-data rights, Node compatibility and measured peak memory on the Render service are documented. |
| FMAK / Free Music Archive datasets | Model training/evaluation data | unverified | Do not ingest/use until per-asset provenance, rights and commercial permissions are verified. |
| GiantSteps datasets | Model training/evaluation data | unverified | Do not ingest/use until per-asset provenance, rights and commercial permissions are verified. |
| Essentia | Audio analysis library/models | denied | Do not add or use under the currently identified licensing options; a commercially compatible licence must be established first. |
| madmom / DBN | Beat tracking | denied | Do not add or use under the currently identified non-commercial licensing; a commercially compatible licence must be established first. |

## Runtime policy implementation

The executable register is `src/providers/provider-policy.ts`. The registry is the sole provider authorization switch. The DSP catalogue dispatcher and embedded worker consult it before third-party calls. Credentials are checked by each integration; a missing credential must be reported as unavailable and must never be represented as a policy denial.

There are no `PROVIDER_ENABLED_<NAME>` variables in the runtime configuration. Removing those switches does not bypass credentials, API rate limits, authentication, vendor contracts, licensing restrictions or the registry's `unverified`/`denied` status. Provider readiness for Groq, Gemini and Ollama requires both an `allowed` registry status and the relevant API credential.

Audio diagnostics are persisted in the existing fenced `sonic_dna` audit event payload; no database migration is required. `scripts/diagnostics-to-fixture.mjs` converts one exported event payload from stdin into a bounded Vitest fixture and deliberately selects only diagnostic fields. The downbeat grid is explicitly a four-beat diagnostic hypothesis, not a meter or downbeat detection claim.

## Evidence labels in reports

- **MEASURED:** derived by a documented first-party algorithm from the submitted audio.
- **PROVIDER-OBSERVED:** returned by an enabled provider, with source and retrieval time.
- **SUBMITTER-SUPPLIED — UNVERIFIED:** supplied by the user and not independently checked.
- **INFERRED:** a transparent hypothesis derived from cited evidence; never present as a fact.
- **UNAVAILABLE:** not retrieved or not permitted. Include the actual reason; do not replace it with a mock value.

Tempo and key must additionally carry method and confidence tier: **Detected**, **Tentative (verify)**, or **Not determined**. A value below Tentative must not drive narrative, score, recommendations or market claims.

## Review checklist

- [ ] Current terms and commercial rights reviewed for the exact product use and territory.
- [ ] Retention, caching, attribution, refresh and deletion requirements recorded.
- [ ] Data use in reports and in any LLM prompt explicitly permitted.
- [ ] Registry status matches the documented permission and integration state.
- [ ] Tests verify denied/unverified sources are never called and approved sources work without per-provider flags.
- [ ] Report displays source, retrieval date, limitations and evidence label.
- [ ] Legal review completed where required.
