"""Original synthesis for the driver GO and END cues.

A matching pair of short warm chimes, each under 400 ms. GO rises. END falls.
Sine partials, soft attack, exponential decay. Loudness-normalized near -16 LUFS
with true peak at or below -1 dBTP. No sampled recordings.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np

SR = 44100
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps" / "driver" / "assets" / "sounds"


def midi_freq(note: int) -> float:
    return 440.0 * 2.0 ** ((note - 69) / 12.0)


def horn_note(freq: float, dur: float, amp: float, rng: np.random.Generator) -> np.ndarray:
    n = max(1, int(round(dur * SR)))
    t = np.arange(n) / SR
    scoop = 0.015 * np.exp(-t / 0.018)
    phase = 2.0 * math.pi * np.cumsum(freq * (1.0 + scoop)) / SR
    tone = (
        np.sin(phase)
        + 0.58 * np.sin(2.0 * phase)
        + 0.36 * np.sin(3.0 * phase)
        + 0.18 * np.sin(4.0 * phase)
        + 0.07 * np.sin(5.0 * phase)
    )
    attack = 1.0 - np.exp(-t / 0.007)
    decay = np.exp(-t / max(dur * 0.45, 0.028))
    crack = rng.standard_normal(n) * np.exp(-t / 0.004) * 0.05
    return (tone * attack * decay + crack) * amp


def place(buf: np.ndarray, clip: np.ndarray, at: float) -> None:
    start = int(round(at * SR))
    end = min(len(buf), start + len(clip))
    if start >= len(buf) or end <= start:
        return
    buf[start:end] += clip[: end - start]


def chime(freq: float, length: float, amp: float) -> np.ndarray:
    n = max(1, int(round(length * SR)))
    t = np.arange(n) / SR
    attack = 1.0 - np.exp(-t / 0.012)
    decay = np.exp(-t / 0.09)
    tone = np.sin(2.0 * math.pi * freq * t)
    tone += 0.22 * np.sin(2.0 * math.pi * freq * 2.0 * t)
    tone += 0.06 * np.sin(2.0 * math.pi * freq * 3.0 * t)
    return tone * attack * decay * amp


def synthesize_go() -> np.ndarray:
    """Rising G4–B4–D5, warm and under 400 ms."""
    dur = 0.36
    buf = np.zeros(int(round(dur * SR)))
    place(buf, chime(392.00, 0.28, 0.42), 0.0)
    place(buf, chime(493.88, 0.26, 0.46), 0.07)
    place(buf, chime(587.33, 0.22, 0.5), 0.14)
    peak = float(np.max(np.abs(buf))) or 1.0
    buf *= 0.7 / peak
    fade = int(0.004 * SR)
    buf[:fade] *= np.linspace(0.0, 1.0, fade)
    buf[-fade:] *= np.linspace(1.0, 0.0, fade)
    return buf


def synthesize_end() -> np.ndarray:
    """Falling D5–B4–G4, the same family as GO."""
    dur = 0.36
    buf = np.zeros(int(round(dur * SR)))
    place(buf, chime(587.33, 0.28, 0.42), 0.0)
    place(buf, chime(493.88, 0.26, 0.46), 0.07)
    place(buf, chime(392.00, 0.22, 0.5), 0.14)
    peak = float(np.max(np.abs(buf))) or 1.0
    buf *= 0.7 / peak
    fade = int(0.004 * SR)
    buf[:fade] *= np.linspace(0.0, 1.0, fade)
    buf[-fade:] *= np.linspace(1.0, 0.0, fade)
    return buf


def write_wav(path: Path, samples: np.ndarray) -> None:
    pcm = np.clip(samples, -1.0, 1.0)
    frames = (pcm * 32767.0).astype(np.int16)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "w") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes(frames.tobytes())


def loudnorm(path: Path) -> None:
    """Target -16 LUFS and a true peak at or below -1 dBTP.

    Clips under 400 ms are too short for an integrated LUFS reading, so a
    -inf measurement falls back to a peak ceiling of -1 dBTP.
    """
    if shutil.which("ffmpeg") is None:
        raise SystemExit("ffmpeg is required")
    measure = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-i", str(path),
            "-af", "loudnorm=I=-16:TP=-1:LRA=11:linear=true:print_format=json",
            "-f", "null", "-",
        ],
        check=True, capture_output=True, text=True,
    )
    log = measure.stderr + measure.stdout
    stats = json.loads(log[log.rfind("{"): log.rfind("}") + 1])
    tmp = path.with_suffix(".norm.wav")
    if stats.get("input_i") in (None, "-inf", "inf") or stats.get("target_offset") in ("inf", "-inf"):
        ceiling = 10 ** (-1.0 / 20.0)
        with wave.open(str(path), "r") as handle:
            frames = np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16).astype(np.float64)
        peak = float(np.max(np.abs(frames))) or 1.0
        scaled = np.clip(frames * (ceiling * 32767.0 / peak), -32767, 32767).astype(np.int16)
        write_wav(path, scaled / 32767.0)
        print(path.name, "peak-ceiling -1 dBTP (clip shorter than a LUFS gate)", "measured_I", stats.get("input_i"))
        return
    measured = (
        "loudnorm=I=-16:TP=-1:LRA=11:linear=true:"
        f"measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:"
        f"measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:"
        f"offset={stats['target_offset']}"
    )
    subprocess.run(
        [
            "ffmpeg", "-y", "-hide_banner", "-i", str(path),
            "-af", measured, "-ar", str(SR), "-ac", "1", "-c:a", "pcm_s16le",
            str(tmp),
        ],
        check=True, capture_output=True, text=True,
    )
    tmp.replace(path)
    print(path.name, "LUFS", stats["input_i"], "TP", stats["input_tp"])


def main() -> None:
    write_wav(OUT / "go.wav", synthesize_go())
    write_wav(OUT / "end.wav", synthesize_end())
    for name in ("go.wav", "end.wav"):
        path = OUT / name
        loudnorm(path)
        with wave.open(str(path), "r") as handle:
            seconds = handle.getnframes() / handle.getframerate()
        print(f"{name} {seconds:.3f}s {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
