# Real-iPhone QA checklist

**Status: not performed.** No physical device was available to this session. Everything below was exercised only with Playwright's iPhone 14 emulation (Chromium engine, 390×844, touch, fake microphone), which is a preliminary check and not a substitute for Safari on a real iPhone.

Run on the production URL after merging. Tick each item and note the iOS and Safari versions.

| # | Check | Emulated | Real device |
| --- | --- | --- | --- |
| 1 | Sign in and onboarding complete without horizontal scroll | ✅ | ☐ |
| 2 | Text entry with the iOS keyboard open: composer stays visible, page does not jump | n/a | ☐ |
| 3 | Scrolling a long interview history is smooth; current question stays at the bottom | ✅ | ☐ |
| 4 | Recording with microphone permission granted (expect `audio/mp4` on Safari) | ✅ (webm) | ☐ |
| 5 | Recording with permission denied shows the explanatory notice; typing still works | ✅ | ☐ |
| 6 | Stop, submit and correct a transcript | ✅ (fixture) | ☐ |
| 7 | Switch between voice and text in one session | ✅ | ☐ |
| 8 | Navigate away and back; the session resumes | ✅ | ☐ |
| 9 | Resume after an interrupted upload (airplane mode mid-upload, then retry) | partial | ☐ |
| 10 | Download the PDF and the Word file (Safari "Download" sheet) | ✅ (API) | ☐ |
| 11 | Safe-area spacing with the home indicator; bottom nav and composer not clipped | ✅ | ☐ |
| 12 | Network interruption: answer retry banner appears and succeeds afterwards | ✅ (simulated) | ☐ |
| 13 | Refresh the page: unsaved draft text and pending submission survive | ✅ | ☐ |
| 14 | Dictation fallback (Safari speech recognition) with the disclosure visible | n/a | ☐ |
| 15 | Add to Home Screen: icon, name, standalone display | n/a | ☐ |

Known Safari-specific points to watch: `MediaRecorder` produces `audio/mp4`; `100dvh` and `env(safe-area-inset-bottom)` are used for the workspace height and bottom bars; the composer uses `position: sticky` within a flex column rather than `fixed`.
