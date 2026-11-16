# Reson8 A&R Audit Engine — Product Context

## Product
A private, evidence-first A&R audit service that turns an uploaded song into a defensible song-specific A&R assessment.

## Audience
Independent artists, managers, labels, publishers, A&R professionals, and music-industry decision makers.

## Core job
Answer: “What is this recording, what does the recording measurably sound like, and what does the evidence imply for A&R positioning and release strategy?”

## Non-negotiables
- Recognition, audio measurement, and A&R interpretation remain separate stages.
- Never invent artist, song, metadata, audio measurements, or market evidence.
- Uploaded masters are the source of measured Sonic DNA.
- AudD recognition is evidence, not the final truth.
- Groq interprets verified evidence; it does not manufacture missing facts.
- Audio and reports remain private.
- Render is the deployment target; Vercel is not part of this system.
- The Audit Engine is isolated from Reson8 and AURA-X databases and application secrets.

## Primary flow
Upload → secure audit job → audio normalization → AudD recognition sample → full-master Sonic DNA → metadata reconciliation → verified Song Evidence Object → Groq A&R assessment → private PDF report.

## Product UI direction
The future UI is an operational professional tool, not a marketing page: fast scanning, clear evidence provenance, explicit confidence, strong empty/error states, and minimal cognitive noise.
