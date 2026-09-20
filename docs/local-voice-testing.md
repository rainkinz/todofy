# Test local voice input

Development builds can use explicit local engine and model files without downloading published assets or using a release signing key. This path exists only in debug builds; release builds always use the signed catalog and verified downloads.

## Linux or macOS

1. Install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), Rust, Bun, CMake, and Git. On Debian/Ubuntu, also install `libasound2-dev` for microphone capture.
2. From the repository root, run:

   ```bash
   bun install --frozen-lockfile
   bash scripts/setup-local-voice.sh
   ```

   The script builds the pinned CPU whisper.cpp CLI and downloads the multilingual Tiny q5_1 model (about 31 MiB) into the ignored `.local-voice/` directory. It checks the source commit and model SHA-1, then transcribes whisper.cpp's sample clip. The model is smaller than the regular Tiny download offered in releases, so accuracy may differ.

3. Copy the command printed by the script and run it from the repository root. It sets `TODOFY_VOICE_DEV_ENGINE` and `TODOFY_VOICE_DEV_MODEL_TINY` for `bun run tauri dev`.
4. In **Settings → Voice**, turn on **Voice Mode**. The local Tiny model is selected automatically when no model was chosen before; if Base was previously selected, choose the **Tiny** radio button first. Settings should say **Using local test files in this debug build**. No download button is needed in this mode.
5. In quick add, click the microphone icon, speak a short task, then click the stop icon. The waveform should stay inside the composer, and the text should appear in the field without creating a task; edit it and click **Add**. In Journal, dictate into an existing draft and confirm its text stays intact before saving. **Cancel** should insert nothing. Try the quick-capture shortcut (`Ctrl+Alt+A`), microphone denial, and silence. Turning Voice Mode off should hide the microphone controls again.

Closing the main window hides it in the tray; use the tray's **Quit** command before restarting with different local files. Local recordings and transcription are private to your machine. Temporary WAV and JSON files are removed after the operation, and stale files are cleaned at startup.

## Windows

Build the pinned whisper.cpp `v1.9.3` source at commit `371b5a7561823ab2bb32142d2751e35e7534727b` with CMake's `whisper-cli` target, and download the multilingual `ggml-tiny-q5_1.bin` model from the [whisper.cpp model collection](https://huggingface.co/ggerganov/whisper.cpp). Verify its SHA-1 is `2827a03e495b1ed3048ef28a6a4620537db4ee51`. In PowerShell, set `TODOFY_VOICE_DEV_ENGINE` to the absolute `whisper-cli.exe` path and `TODOFY_VOICE_DEV_MODEL_TINY` to the model path, then run `bun run tauri dev`. Choose Tiny in Settings.

This local path tests recording, transcription, and editor insertion. To test **Download**, **Update**, and **Remove**, use a packaged release with a published signed voice catalog and platform assets.
