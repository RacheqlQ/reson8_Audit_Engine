# Third-party audio analysis license review

Review date: 2026-11-20

This inventory records upstream license evidence for the optional audio-analysis candidates considered by Reson8 Audit Engine. It is an engineering inventory, not legal advice. Re-check the exact upstream revision, model artifact, transitive dependencies, and distribution method before adding or shipping any component.

## Decision summary

| Candidate | Code license | Model / weights | Commercial-use gate | Integration status |
|---|---|---|---|---|
| Essentia | **Verified: AGPL-3.0** per the upstream repository's licensing information | **Verified: CC BY-NC-SA 4.0** for MTG-provided pretrained models | Do not use in the commercial product without an appropriate written commercial licence from MTG/UPF; separately clear any selected third-party algorithm dependencies | Not integrated; blocked pending commercial licence and dependency review |
| madmom | **Verified: BSD-style source-code licence** from upstream `LICENSE` | **Verified: CC BY-NC-SA 4.0** for model/data files in the same upstream `LICENSE` | Source code may be evaluated under its BSD conditions, but do not use bundled model/data files or technology utilising them commercially without permission from the rights holder | Not integrated; bundled models are blocked pending commercial permission |
| Beat This! | **Verified: MIT** from upstream `LICENSE` | **Verified: upstream README states published model weights are MIT** | Candidate is permissively licensed for commercial use when using the upstream code and published model weights covered by that statement; do not assume training datasets or unrelated artifacts are included | Eligible for further evaluation only; not integrated pending dependency, model-artifact, and memory review |

## Evidence inspected

### Essentia

- Upstream repository: https://github.com/MTG/essentia
- File inspected: [`doc/sphinxdoc/licensing_information.rst`](https://github.com/MTG/essentia/blob/master/doc/sphinxdoc/licensing_information.rst)
- Evidence: the repository licensing information states that Essentia is offered under AGPLv3 for non-commercial applications; MTG-provided pretrained models are CC BY-NC-SA 4.0 for non-commercial use and proprietary licensing is available on request.
- Additional obligation: the same document warns that some algorithms use third-party GPL/LGPL and other dependencies for which upstream does not provide full sublicensing rights. The exact algorithms and build configuration must be reviewed.
- Status: **Verified — upstream licensing-information file inspected.** No separate root `LICENSE` file was located in the inspected repository path; this entry relies on the upstream licensing-information file.

### madmom

- Upstream repository: https://github.com/CPJKU/madmom
- File inspected: [`LICENSE`](https://github.com/CPJKU/madmom/blob/main/LICENSE)
- Evidence: the file grants BSD-style terms for source code, and separately assigns CC BY-NC-SA 4.0 to data/model files. It explicitly says commercial products using model/data files or technology utilising them require contacting the rights holder.
- Status: **Verified — upstream LICENSE file inspected.**

### Beat This!

- Upstream repository: https://github.com/CPJKU/beat_this
- Files inspected: [`LICENSE`](https://github.com/CPJKU/beat_this/blob/main/LICENSE) and [`README.md`](https://github.com/CPJKU/beat_this/blob/main/README.md)
- Evidence: the LICENSE is MIT. The README explicitly states that the code and published model weights are released under that MIT license, while warning that training files may be fully copyrighted or under limited Creative Commons licenses.
- Status: **Verified — upstream LICENSE and README inspected.** This does not clear training datasets or third-party dependencies.

## Runtime and release gates

1. No candidate is enabled by this inventory. No environment variables were read or changed.
2. Do not integrate Essentia or madmom model/data assets into the commercial product unless the required written commercial permissions are obtained and recorded.
3. Beat This! is the only candidate currently cleared by the inspected upstream statements for further commercial-use evaluation. Before integration:
   - pin an exact upstream revision and exact published checkpoint;
   - preserve MIT copyright and permission notices;
   - inventory and approve all runtime/transitive dependencies and their licenses;
   - keep the adapter isolated and disabled by default behind its own feature flag;
   - prove graceful fallback when disabled, missing, invalid, or failing;
   - benchmark peak RSS and processing time on representative maximum-size masters against the Render 512 MiB service limit; do not enable if the memory headroom is inadequate.
4. No detector accuracy claim may be made without a measured comparison against a documented reference set.
5. The existing in-house detectors remain the production path. This document does not imply that any optional detector has been installed, executed, or enabled.
