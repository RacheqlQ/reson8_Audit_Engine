# Reson8 Audit Engine

Reson8 Audit Engine generates evidence-labelled A&R and music-catalogue audit reports from uploaded audio masters or supported DSP metadata.

Public intake does not require an account or password. Each accepted audit receives a cryptographically random, job-scoped capability token; only its SHA-256 hash is stored. The submitting browser sends that token to read audit status and download the sample report. A job ID alone never grants access. Keep the token private: anyone who obtains it can access that audit.

Payments are currently disabled. While payment verification is disabled, the matching job-scoped capability token unlocks both the sample and full report for that job. When PAYMENTS_ENABLED is true, verified payment is mandatory and the capability token does not bypass that gate; until payment verification and respondent entitlements are implemented, full-report requests fail closed with HTTP 402. Sample reports remain available with the job capability token alone. Do not enable PAYMENTS_ENABLED for public paid access before payment verification is implemented. The raw capability is issued once and held only in page memory; users can reveal or copy it from the page and may paste it into the full-report access field. It is never persisted in browser storage or the database.

Environment variable names include NODE_ENV, PORT, provider credentials, SUPABASE_URL, SUPABASE_SECRET_KEY, GROQ_API, GROQ_MODEL, GEMINI_API_KEY, OLLAMA_API_KEY, PUBLIC_AUDIT_OWNER_EMAIL, PUBLIC_AUDIT_RATE_LIMIT_PER_HOUR, `PAYMENTS_ENABLED`, and `RESON8_OPERATOR_KEY`. There are no per-provider environment switches. Operational availability is determined by the executable policy registry and each integration’s actual credentials/configuration. All listed sources are operationally authorized when implemented and configured, subject to actual credentials, applicable licences, vendor contracts, rate limits, attribution, retention and deletion requirements. This authorization does not itself install dependencies or create missing integrations; Spotify-derived catalogue content remains excluded from Groq assessment inputs. Audiomack uses only its official OAuth-signed Data API; the service does not scrape Audiomack pages or collect playback metrics.


## Commercial provider policy

The executable register is `src/providers/provider-policy.ts`; the full status register and source terms are in `docs/data-and-licence-policy.md`. Providers marked `allowed` are operationally available without a separate per-provider environment switch, subject to their required credentials, API limits and terms. Registry authorization does not waive provider terms or prove that an external commercial agreement exists; contract-dependent sources remain usable only within an applicable executed agreement. Groq and AudD are operationally authorized by the product owner; this is not a legal determination and does not waive applicable terms, data-use, audio-processing, retention or deletion obligations.

Implemented DSP metadata enrichment runs when its actual credentials/configuration are present; missing credentials are reported as `not_configured`. No `PROVIDER_ENABLED_<NAME>` switches are read. Registry authorization does not create integrations for providers whose clients or model runtimes are not yet implemented; see the integration-availability section in the data policy.

Keep `PAYMENTS_ENABLED=false`. Provider-policy changes do not enable or alter payment processing.
