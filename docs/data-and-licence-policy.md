# Data and licence policy

**Status:** executable fail-closed provider registry added; provider enforcement and live commercial permissions still require CI and operational verification.  
**Last reviewed:** 2026-11-15  
**Scope:** Reson8 Audit Engine and its embedded worker.  
**Legal note:** This document is an engineering control, not legal advice. Obtain legal review for commercial deployment and review provider terms again before enabling any integration.

## Operating rules

1. Use submitter-supplied audio and metadata only for the requested audit, subject to the submitter's authority to provide them. Do not train models on submitted masters.
2. Prefer first-party analysis implemented in this repository. Record the algorithm, version, inputs, confidence tier and limitations for every audio-derived claim.
3. A provider being technically integrated, having credentials, or returning data does not establish commercial permission. Each provider requires a current terms review and explicit opt-in configuration.
4. Providers with **unverified** or **denied** commercial status must remain disabled. Missing credentials, disabled flags, rate limits, provider errors and policy rejections must be reported as unavailable; never silently substitute fabricated or stale values.
5. Reports must identify data sources and methods, distinguish submitter-supplied/unverified information from provider observations and measured analysis, and include retrieval timestamps where applicable.
6. Do not retain third-party audio or provider payloads beyond the documented operational need. Diagnostic events must contain derived features only, not audio samples or reconstructable audio.
7. Payment controls are separate from data-provider controls. `PAYMENTS_ENABLED` remains false by default and must not be enabled as part of this policy work.

## Commercial status register

| Source / component | Intended use | Status | Enablement rule | Evidence / decision |
|---|---|---|---|---|
| Submitter-supplied audio and metadata | Requested audio analysis and catalogue context | allowed, subject to submitter authority | Enabled for the submitted job only | User-provided material; do not use for model training. |
| Reson8 first-party DSP algorithms | Onset, tempo candidates, chroma/key estimates, signal diagnostics | allowed, subject to code provenance review | Internal implementation only; disclose method and confidence | Repository-owned code. Do not imply a model or measurement that was not run. |
| MusicBrainz | Release/recording identifiers and public catalogue metadata | allowed with conditions | Require `PROVIDER_ENABLED_MUSICBRAINZ=true`; use a descriptive User-Agent containing `MUSICBRAINZ_CONTACT`; maximum 1 request/second; provide attribution | https://musicbrainz.org/doc/MusicBrainz_Database/License and https://musicbrainz.org/doc/MusicBrainz_API |
| ListenBrainz | Public listening/artist context where available | allowed with conditions | Require `PROVIDER_ENABLED_LISTENBRAINZ=true`; respect API limits and attribution; do not infer market share from incomplete observations | https://listenbrainz.org/ and https://github.com/metabrainz/listenbrainz-server |
| YouTube Data API | Submitter-linked channel/video metadata and permitted public metrics | allowed with conditions | Require `PROVIDER_ENABLED_YOUTUBE=true` and `YOUTUBE_API_KEY`; follow YouTube API Services Terms, Developer Policies, attribution and refresh/deletion rules | https://developers.google.com/youtube/terms/api-services-terms-of-service and https://developers.google.com/youtube/terms/developer-policies |
| Beat This! (MIT code and small0 weights/conversion) | Optional tempo/beat inference | unverified pending artifact provenance, training-data review and runtime fit | Do not enable until exact model artifact, commit, SHA-256, MIT licence, conversion provenance, Node 22 compatibility and measured peak memory on the 512 MB Render Free service are documented. | https://github.com/CPJKU/beat_this ; upstream MIT licence applies to repository code/weights as stated upstream; training-data rights and third-party conversion provenance require separate review. |
| Groq | LLM assessment processing | unverified | Disabled unless commercial processing, retention and data-use terms are approved; requires `PROVIDER_ENABLED_GROQ=true` after registry status is changed to allowed | https://groq.com/terms-of-use/ |
| Spotify | Catalogue cross-reference only | unverified | Disabled unless `PROVIDER_ENABLED_SPOTIFY=true` and current commercial/API permission is documented; the runtime registry remains unverified and will reject the flag | https://developer.spotify.com/terms |
| Apple Music / iTunes lookup | Catalogue cross-reference only | unverified | Disabled unless `PROVIDER_ENABLED_APPLE_MUSIC=true` and current commercial/API permission is documented; runtime registry rejects unverified status | https://developer.apple.com/musickit/ |
| YouTube Music oEmbed | Submitter-linked music metadata | unverified | Disabled unless `PROVIDER_ENABLED_YOUTUBE_MUSIC=true` and the exact commercial workflow is cleared | https://developers.google.com/youtube/terms/api-services-terms-of-service |
| TIDAL | Catalogue cross-reference only | unverified | Disabled unless `PROVIDER_ENABLED_TIDAL=true` and current commercial/API permission is documented | https://developer.tidal.com/ |
| Audiomack Data API | Catalogue cross-reference only; no scraping or playback metrics | unverified | Disabled unless `PROVIDER_ENABLED_AUDIOMACK=true` and written/current commercial permission is documented | https://api.audiomack.com/ ; credentials alone are not permission. |
| AudD | Recording identification / metadata | unverified | Disabled unless `PROVIDER_ENABLED_AUDD=true` and current commercial permission, retention and audio-processing terms are documented; the embedded worker will not instantiate it while unverified | https://audd.io/terms/ |
| Last.fm | Catalogue/listening metadata | unverified | Disabled unless `LASTFM_COMMERCIAL_AGREEMENT=true` and `PROVIDER_ENABLED_LASTFM=true` | https://www.last.fm/api/tos |
| Deezer | Catalogue/listening metadata | denied for this product pending a new written commercial grant | Keep disabled; do not call API | https://developers.deezer.com/ |
| Essentia | Audio analysis library/models | denied | Do not add or use; identified licensing options include non-commercial and AGPL obligations incompatible with this product's current policy | https://essentia.upf.edu/licensing_information.html |
| madmom / DBN | Beat tracking | denied | Do not add or use; non-commercial licensing is incompatible with this product's current policy | https://github.com/CPJKU/madmom |
| FMAK / Free Music Archive datasets | Model training/evaluation data | unverified | Do not use until each asset's provenance, rights and commercial permissions are verified | https://github.com/mdeff/fma |
| GiantSteps datasets | Model training/evaluation data | unverified | Do not use until each asset's provenance, rights and commercial permissions are verified | https://www.audiolabs-erlangen.de/resources/MIR/2016-GiantSteps |
| Chartmetric / Soundcharts / Luminate | Paid market intelligence | unverified; disabled | No integration or data ingestion without an executed commercial agreement and approved credentials | https://chartmetric.com/ ; https://soundcharts.com/ ; https://luminatedata.com/ |

## Required provider configuration

The executable registry is `src/providers/provider-policy.ts`. It currently registers Groq, AudD, Spotify, Apple Music/iTunes, YouTube Music oEmbed, TIDAL, Audiomack, Deezer, MusicBrainz, ListenBrainz, YouTube Data API, Last.fm, Beat This!, FMAK, GiantSteps, Chartmetric, Soundcharts, Luminate, Essentia and madmom. The DSP catalogue dispatcher and embedded worker consult the registry before third-party calls. Registry status is authoritative; setting an environment flag cannot promote an unverified or denied source.

Every provider integration must have:
- a registry entry with stable provider ID, intended purpose, `commercialStatus` (`allowed`, `unverified`, or `denied`), terms/evidence URL, attribution requirements, retention constraints and enablement environment variable;
- a default-off `PROVIDER_ENABLED_<NAME>` flag for optional third-party sources (all flags are explicitly false in `.env.example`);
- a fail-closed check that rejects a provider unless its status is `allowed` and its flag is explicitly `true`;
- a reportable disabled reason, using the exact phrase **"disabled by data policy"** for unverified or denied providers;
- tests proving disabled providers are never called, including when credentials are present. Initial registry tests cover credential-only, unverified-plus-flag, denied-plus-flag and non-exact boolean values; CI must verify them before acceptance.

An environment variable is a runtime gate, not evidence of a licence. Do not mark a provider allowed merely because an API key exists.

## Evidence labels in reports

- **MEASURED:** derived by a documented first-party algorithm from the submitted audio.
- **PROVIDER-OBSERVED:** returned by an enabled provider, with source and retrieval time.
- **SUBMITTER-SUPPLIED — UNVERIFIED:** supplied by the user and not independently checked.
- **INFERRED:** a transparent hypothesis derived from cited evidence; never present as a fact.
- **UNAVAILABLE:** not retrieved or not permitted. Include the reason; do not replace it with a mock value.

Tempo and key must additionally carry method and confidence tier: **Detected**, **Tentative (verify)**, or **Not determined**. A value below Tentative must not drive narrative, score, recommendations or market claims.

## Review checklist before enabling a provider

- [ ] Current terms and commercial rights reviewed for the exact product use and territory.
- [ ] Retention, caching, attribution, refresh and deletion requirements recorded.
- [ ] Data use in reports and in any LLM prompt explicitly permitted.
- [ ] Provider registry and default-off flag implemented.
- [ ] Tests verify policy denial and disabled-provider behavior.
- [ ] Report displays source, retrieval date, limitations and evidence label.
- [ ] Legal review completed where required.
