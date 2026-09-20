#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VOICE_DIR="$PROJECT_DIR/.local-voice"
SOURCE_DIR="$VOICE_DIR/whisper.cpp"
BUILD_DIR="$VOICE_DIR/build"
MODEL_FILE="$VOICE_DIR/ggml-tiny-q5_1.bin"
MODEL_SHA1=2827a03e495b1ed3048ef28a6a4620537db4ee51
SOURCE_COMMIT=371b5a7561823ab2bb32142d2751e35e7534727b

case "$(uname -s)" in
  Linux|Darwin) ;;
  *) echo "This helper supports Linux and macOS. See docs/local-voice-testing.md for Windows." >&2; exit 1 ;;
esac

mkdir -p "$VOICE_DIR"
if [[ ! -d "$SOURCE_DIR/.git" ]]; then
  git clone --depth 1 --branch v1.9.3 https://github.com/ggml-org/whisper.cpp.git "$SOURCE_DIR"
fi
if [[ "$(git -C "$SOURCE_DIR" rev-parse HEAD)" != "$SOURCE_COMMIT" ]]; then
  echo "The local whisper.cpp checkout does not match the pinned release source." >&2
  exit 1
fi

cmake -S "$SOURCE_DIR" -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_NATIVE=OFF \
  -DGGML_OPENMP=OFF \
  -DGGML_METAL=OFF \
  -DGGML_CUDA=OFF \
  -DGGML_SSE42=OFF \
  -DGGML_AVX=OFF \
  -DGGML_AVX2=OFF \
  -DGGML_BMI2=OFF \
  -DGGML_FMA=OFF \
  -DGGML_F16C=OFF \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON
cmake --build "$BUILD_DIR" --config Release --target whisper-cli --parallel 2
ENGINE_FILE="$BUILD_DIR/bin/whisper-cli"
test -x "$ENGINE_FILE"

model_hash() {
  if command -v sha1sum >/dev/null 2>&1; then
    sha1sum "$1" | cut -d' ' -f1
  else
    shasum -a 1 "$1" | cut -d' ' -f1
  fi
}

if [[ ! -f "$MODEL_FILE" ]] || [[ "$(model_hash "$MODEL_FILE")" != "$MODEL_SHA1" ]]; then
  curl --fail --location --show-error --progress-bar --retry 3 \
    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin' \
    --output "$MODEL_FILE.part"
  if [[ "$(model_hash "$MODEL_FILE.part")" != "$MODEL_SHA1" ]]; then
    echo "Downloaded model checksum did not match the published model." >&2
    exit 1
  fi
  mv "$MODEL_FILE.part" "$MODEL_FILE"
fi

SAMPLE_FILE="$VOICE_DIR/jfk.wav"
if [[ ! -f "$SAMPLE_FILE" ]]; then
  curl --fail --location --show-error --silent --retry 3 \
    "https://raw.githubusercontent.com/ggml-org/whisper.cpp/$SOURCE_COMMIT/samples/jfk.wav" \
    --output "$SAMPLE_FILE"
fi
"$ENGINE_FILE" -m "$MODEL_FILE" -f "$SAMPLE_FILE" -l en -oj -of "$VOICE_DIR/smoke" -np >/dev/null
test -s "$VOICE_DIR/smoke.json"

echo
echo "Local engine and Tiny test model passed a sample transcription. Run Todofy with:"
printf 'TODOFY_VOICE_DEV_ENGINE=%q TODOFY_VOICE_DEV_MODEL_TINY=%q bun run tauri dev\n' \
  "$ENGINE_FILE" "$MODEL_FILE"
