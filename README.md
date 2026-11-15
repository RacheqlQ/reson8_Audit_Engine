# Reson8 Audit Engine

Reson8 Audit Engine generates evidence-labelled A&R and music-catalogue audit reports from uploaded audio masters or supported DSP metadata.

Public intake does not require an account or password. Each accepted audit receives a cryptographically random, job-scoped capability token; only its SHA-256 hash is stored. The submitting browser sends that token to read audit status and download the sample report. A job ID alone never grants access. Keep the token private: anyone who obtains it can access that audit.

Payments are currently disabled. While payment verification is disabled, the matching job-scoped capability token unlocks both the sample and full report for that job. When PAYMENTS_ENABLED is true, verified payment is mandatory and the capability token does not bypass that gate; until payment verification and respondent entitlements are implemented, full-report requests fail closed with HTTP 402. Sample reports remain available with the job capability token alone. Do not enable PAYMENTS_ENABLED for public paid access before payment verification is implemented. The raw capability is issued once and held only in page memory; users can reveal or copy it from the page and may paste it into the full-report access field. It is never persisted in browser storage or the database.

Environment variable names include NODE_ENV, PORT, provider credentials, SUPABASE_URL, SUPABASE_SECRET_KEY, GROQ_API, GROQ_MODEL, PUBLIC_AUDIT_OWNER_EMAIL, PUBLIC_AUDIT_RATE_LIMIT_PER_HOUR, `PROVIDER_ENABLED_<NAME>`, `LASTFM_COMMERCIAL_AGREEMENT`, `PAYMENTS_ENABLED`, and `RESON8_OPERATOR_KEY`. Spotify, TIDAL, Apple/iTunes, YouTube Music, Deezer and Audiomack catalogue calls are currently blocked by the executable policy registry because their commercial status is unverified or denied; credentials do not bypass that decision. Spotify-derived catalogue content remains excluded from Groq assessment inputs. Audiomack, when approved in a future policy review, must use only its official OAuth-signed Data API; the service does not scrape Audiomack pages or collect playback metrics.


## Commercial provider policy

The executable register is `src/providers/provider-policy.ts`; the full status register and source terms are in `docs/data-and-licence-policy.md`. Optional provider flags are default-off. Credentials alone do not enable a provider: the registry must mark its commercial status `allowed` and the exact `PROVIDER_ENABLED_<NAME>` value must be `true`. Unverified and denied providers remain disabled even when credentials and flags are present. Groq has been operationally enabled by explicit product-owner authorization, subject to the exact opt-in flag; this is not a legal determination and does not waive Groq's applicable terms, data-use, retention or deletion obligations. AudD remains unverified and disabled. DSP links from unverified or denied sources are retained as submitted links but enrichment is reported unavailable with the reason `disabled by data policy`.

Keep `PAYMENTS_ENABLED=false`. Provider-policy changes do not enable or alter payment processing.
