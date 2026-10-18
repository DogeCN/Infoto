# 0002: Progress Reports Only Real Measurements

- **Date**: 2026-09-27
- **Status**: Accepted
- **Context**: v1 synthesised a single progress figure per batch by weighting stages together — `PHASE = {PREP: 0.20, UPLOAD: 0.75, SYNC: 0.05}` with `units = video ? max(6MB, size*8) : size`, averaged across the queue. It looked informative and moved smoothly. None of those numbers were measurements: the stage split was a guess at where time goes, the ×8 video weight was a guess at relative cost, and `uploadBytes` was a stand-in for a stage that had not started. The visible symptom was that a batch of pure images sat pinned at 0% for the entire compression phase and then jumped.
- **Decision**: **No invented percentages.** A leg that cannot measure itself mid-flight renders as indeterminate (sweep), and `fraction` is simply absent from the status message. `UploadPanel.indeterminate` keys off `fraction == null`. Weights are permitted only to combine legs that share a dimension into one ratio.
- **Consequences**:
  - Each leg reports a **same-dimension single ratio** — frames/frames (GIF), seconds/seconds (video), bytes/bytes (hashing), bytes/bytes (upload) — so no cross-stage weighting is ever needed. The question "where does this weight come from?" became unanswerable-by-construction rather than a matter of discipline.
  - Asking to reuse one pipeline's progress for another leg is now explicitly forbidden: hashing and disk-write are one tee loop, but they consume the Blob that `transcodeImage` returns _after_ transcoding ends, so the counter reads 0 throughout the transcode phase.
  - "Fits exactly" is not good enough for a layout bar either (see 0003) — a requirement met to the pixel leaves the flexible spacer at 0px and one sub-pixel from overflow.
- **Alternatives considered**:
  - _Keep the weighted aggregate but label it as an estimate_: rejected — the numbers move, so users read them as measurements; the label does not survive contact with a loading bar.
  - _Time-weighted stage estimates from a calibration pass_: rejected — adds a calibration table and a per-device constant, and is still not a measurement of the current file.
  - _Report nothing at all until completion_: rejected — the video and upload legs genuinely do measure, and discarding real data to satisfy a purity rule loses information.
