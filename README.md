# Reson8 Audit Engine

Reson8 Audit Engine generates evidence-labelled A&R and music-catalogue audit reports from uploaded audio masters or supported DSP metadata.

Public intake does not require an account or password. Each accepted audit receives a cryptographically random, job-scoped capability token; only its SHA-256 hash is stored. The submitting browser sends that token to read audit status and download the sample report. A job ID alone never grants access. Keep the token private: anyone who obtains it can access that audit.

Payments are currently disabled. While payment verification is disabled, full reports require both the job capability token and an authorized Reson8 operator key. When PAYMENTS_ENABLED is true, verified payment is mandatory and operator credentials do not bypass that gate; until payment verification and respondent entitlements are implemented, full-report requests fail closed with HTTP 402. Sample reports remain available with the job capability token alone. Do not enable PAYMENTS_ENABLED for public paid access before payment verification is implemented. The raw capability is issued once and held only in page memory; users should download and securely retain the credential before closing or reloading the page.

Environment variable names: NODE_ENV, PORT, AUDD_API, SUPABASE_URL, SUPABASE_SECRET_KEY, GROQ_API, GROQ_MODEL, PUBLIC_AUDIT_OWNER_EMAIL, PUBLIC_AUDIT_RATE_LIMIT_PER_HOUR, PAYMENTS_ENABLED, RESON8_OPERATOR_KEY.
