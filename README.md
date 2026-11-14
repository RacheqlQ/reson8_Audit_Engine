# Reson8 Audit Engine

Reson8 Audit Engine generates evidence-labelled A&R and music-catalogue audit reports from uploaded audio masters or supported DSP metadata.

Public intake does not require an account or password. Each accepted audit receives a cryptographically random, job-scoped capability token; only its SHA-256 hash is stored. The submitting browser sends that token to read audit status and download the sample report. A job ID alone never grants access. Keep the token private: anyone who obtains it can access that audit.\n\nPayments are currently disabled. Full reports remain restricted to the authenticated Reson8 operator until Flutterwave payment verification and respondent entitlements are implemented. Operator full-report requests must also present the job capability token. Do not enable PAYMENTS_ENABLED for public paid access before that work is complete.

Environment variable names: NODE_ENV, PORT, AUDD_API, SUPABASE_URL, SUPABASE_SECRET_KEY, GROQ_API, GROQ_MODEL, PUBLIC_AUDIT_OWNER_EMAIL, PUBLIC_AUDIT_RATE_LIMIT_PER_HOUR, PAYMENTS_ENABLED, RESON8_OPERATOR_KEY.
