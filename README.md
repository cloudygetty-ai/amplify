# AMPLIFY — Sentinel Audio Engine v6

> Real-time voice isolation, spectral noise gate, pitch detection, and recorder. Built on the Web Audio API.

**[→ Open App](https://amplify-git-main-cloudygetty-ais-projects.vercel.app)**

## Features

- **Auto Noise Gate** — Spectral subtraction + voice-band gating. Auto-calibrates to your room in 2 seconds
- **HP → Gate → 8-Band EQ → LP → Compressor → Gain** — Full DSP chain, each stage bypassable
- **Live Analysis** — Pitch (Hz), Musical note, Cents sharp/flat, BPM estimate, Clarity %, Dynamic range
- **Oscilloscope** — Zero-crossing triggered waveform display
- **Recorder** — Captures post-DSP processed audio, playback + download
- **Invisible Mode** — Hide the entire UI, app keeps running. Press `Escape` or tap the floating button
- **Presets** — Low Voice, Whisper, Conference, Studio, Broadcast

## Stack

Pure HTML + Web Audio API. No framework, no build step, no dependencies.

## Deploy

Hosted on Vercel as a static site. Any push to `main` auto-deploys.
