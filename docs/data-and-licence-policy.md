# Data and licence policy

**Status:** registry-driven operational authorization; no per-provider enable flags.
**Last reviewed:** 2026-11-18
**Scope:** Reson8 Audit Engine and its embedded worker.
**Legal note:** This is an engineering control, not legal advice or a representation that a vendor has granted rights. Product-owner operational authorization does not waive provider terms, API contracts, model licences, territory limits, attribution, retention or deletion requirements.

## Operating rules

1. Use submitter-supplied audio and metadata only for the requested audit, subject to the submitter's authority to provide them. Do not train models on submitted masters.
2. Prefer first-party analysis implemented in this repository. Record the algorithm/model, version, inputs, confidence tier and limitations for every audio-derived claim.
3. `src/providers/provider-policy.ts` is the sole operational authorization switch. Every currently registered source is marked `allowed` by explicit product-owner authorization. No `PROVIDER_ENABLED_<NAME>` variables are read or required.
4. Provider credentials are checked by each implemented integration. Missing credentials/configuration must be reported as `not_configured`, never as `disabled by data policy`. Provider authorization does not waive source-specific licences, vendor contracts, API terms, rate limits, attribution, caching, retention or deletion obligations.
5. Never silently substitute fabricated or stale values. Reports identify data sources and methods, distinguish submitter-supplied/unverified information from provider observations and measured analysis, and include retrieval timestamps where applicable.
6. Do not retain third-party audio or provider payloads beyond the documented operational need. Diagnostic events contain derived features only: a normalized onset envelope capped at 128 values, beat markers capped at 512, heuristic four-beat downbeat candidates capped at 128, and up to 12 normalized 12-bin chroma segments. Never store PCM samples, audio bytes, access tokens or reconstructable audio in diagnostics.
7. Payment controls are separate from data-provider controls. `PAYMENTS_ENABLED=false` remains unchanged and payments must remain disabled.

## Operational authorization register

| Source / component | Intended use | Registry status | Runtime / use condition |
|---|---|---|---|
| Submitter-supplied audio and metadata | Requested audio analysis and catalogue context | allowed | Submitted job only; submitter must have authority; no model training on masters |
| Reson8 first-party DSP algorithms | Onset, tempo candidates, chroma/key estimates, signal diagnostics | allowed | Internal implementation; disclose method and confidence; do not claim a model/measurement that was not run |
| Groq | LLM assessment processing | allowed | Requires `GROQ_API` or `GROQ_API_KEY`; follow current API data-use, retention and deletion terms |
| Gemini | LLM assessment fallback | allowed | Requires `GEMINI_API_KEY`; follow Google AI terms and data handling |
| Ollama Cloud | LLM assessment fallback | allowed | Requires `OLLAMA_API_KEY`; use hosted cloud API only from the embedded worker |
| AudD | Recording identification / metadata | allowed | Requires `AUDD_API` or `AUDD_API_TOKEN`; follow audio-processing, retention and deletion terms |
| Spotify | Catalogue metadata cross-reference | allowed | Requires Spotify client credentials; follow API terms, display, refresh and deletion requirements |
| Apple Music / iTunes lookup | Catalogue metadata cross-reference | allowed | Public lookup integration; follow applicable Apple terms, attribution and caching requirements |
| YouTube Music oEmbed | Submitter-linked music metadata | allowed | Use only supported oEmbed metadata; comply with YouTube terms and attribution |
| TIDAL | Catalogue metadata cross-reference | allowed | Requires TIDAL client credentials; comply with current API terms and data handling |
| Audiomack official Data API | Catalogue metadata cross-reference | allowed | Requires OAuth client credentials; use only the official signed Data API; no scraping or playback metrics |
| Deezer | Public track metadata cross-reference | allowed | Use the implemented track endpoint only within current Deezer API terms, rate limits and applicable restrictions |
| MusicBrainz | Release/recording identifiers and public catalogue metadata | allowed | Attribution, descriptive User-Agent containing `MUSICBRAINZ_CONTACT`, maximum 1 request/second |
| ListenBrainz | Public listening/artist context | allowed | Respect API limits and attribution; do not infer market share from incomplete observations |
| YouTube Data API | Submitter-linked channel/video metadata and permitted public metrics | allowed | Requires `YOUTUBE_API_KEY`; follow API Services Terms, Developer Policies, attribution and refresh/deletion rules |
| Last.fm | Catalogue/listening metadata | allowed | Requires valid API credentials; comply with API terms, attribution, caching and deletion |
| Beat This! | Optional tempo/beat inference | allowed | Use an identified artifact only where its licence, conversion provenance, training-data rights and Render runtime compatibility permit deployment; record commit and SHA-256 |
| FMAK / Free Music Archive datasets | Model training/evaluation data | allowed | Use only individually identified assets whose licence permits the intended use; retain asset-level provenance and attribution |
| GiantSteps datasets | Model training/evaluation data | allowed | Use only individually identified assets whose licence permits the intended use; retain asset-level provenance and attribution |
| Essentia | Audio analysis library/models | allowed | Use only versions/model artifacts whose applicable licence permits this product and deployment; preserve notices and obligations |
| madmom / DBN | Beat tracking | allowed | Use only versions/model artifacts whose applicable licence permits this product and deployment; preserve notices and obligations |
| Chartmetric / Soundcharts / Luminate | Paid market intelligence | allowed | Call only under the applicable executed commercial agreement and approved credentials; follow contract-specific attribution, storage and deletion clauses |

## Integration availability

Registry authorization removes policy-based blocking; it does not create a client, install a dependency, or prove that a third-party service is configured.

**Implemented and callable in this Node service when credentials/configuration are present:** Groq, Gemini, Ollama Cloud, AudD, Spotify, Apple/iTunes lookup, YouTube Music oEmbed, TIDAL, Audiomack official Data API and Deezer public track metadata.

**Authorized in the registry but not currently wired as callable integrations/models in this service:** MusicBrainz, ListenBrainz, YouTube Data API, Last.fm, Chartmetric, Soundcharts, Luminate, Beat This!, Essentia, madmom, FMAK and GiantSteps. These are no longer blocked by a policy flag; no API/model call can occur until a real integration or compatible model runtime is implemented. Do not report them as measured or provider-observed until such an integration has actually run. Model and dataset licences and vendor agreements remain conditions of actual use.

## Runtime policy implementation

The executable register is `src/providers/provider-policy.ts`. The DSP catalogue dispatcher and embedded worker consult it before third-party calls. There are no `PROVIDER_ENABLED_<NAME>` variables or per-provider true/false opt-ins. Credentials are checked by each integration; missing credentials are reported as `not_configured`.

Audio diagnostics are persisted in the existing fenced `sonic_dna` audit event payload; no database migration is required. `scripts/diagnostics-to-fixture.mjs` converts one exported event payload from stdin into a bounded Vitest fixture and deliberately selects only diagnostic fields. The downbeat grid is explicitly a four-beat diagnostic hypothesis, not a meter or downbeat detection claim.

## Evidence labels in reports

- **MEASURED:** derived by a documented first-party algorithm from the submitted audio.
- **PROVIDER-OBSERVED:** returned by an implemented provider integration, with source and retrieval time.
- **SUBMITTER-SUPPLIED — UNVERIFIED:** supplied by the user and not independently checked.
- **INFERRED:** a transparent hypothesis derived from cited evidence; never present as a fact.
- **UNAVAILABLE:** not retrieved. Include the actual reason; do not replace it with a mock value.

Tempo and key must additionally carry method and confidence tier: **Detected**, **Tentative (verify)**, or **Not determined**. A value below Tentative must not drive narrative, score, recommendations or market claims.

## Review checklist

- [ ] Current terms and commercial rights reviewed for the exact product use and territory.
- [ ] Retention, caching, attribution, refresh and deletion requirements recorded.
- [ ] Data use in reports and in any LLM prompt explicitly permitted.
- [ ] Registry status matches product-owner operational authorization and the source's actual licence/contract restrictions.
- [ ] Tests verify authorized implemented sources are called when configured, without per-provider enable flags.
- [ ] Report displays source, retrieval date, limitations and evidence label.
- [ ] Legal review completed where required.
