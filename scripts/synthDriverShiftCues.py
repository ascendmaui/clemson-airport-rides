"""Original synthesis for the driver GO and END cues.

GO quotes the 1917 public-domain horn hook (arpeggiated trio strain) and ends
with a short low boom. END is a separate soft descending two-tone chime.
No sampled recordings.
"""

from __future__ import annotations

import math
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


def synthesize_go() -> np.ndarray:
    rng = np.random.default_rng(1917)
    eighth = 0.072
    quarter = 0.144
    # Arpeggiated 1917 trio hook, compressed into a short fanfare.
    bars = [
        (70, 74, 77, 82),  # Bb D F Bb
        (80, 79, 77, 74),  # Ab G F D
        (72, 75, 79, 84),  # C Eb G C
        (82, 80, 79, 77),  # Bb Ab G F
    ]
    events: list[tuple[float, float, float, float]] = []
    cursor = 0.02
    for bar_i, notes in enumerate(bars):
        durs = (eighth, eighth, eighth, quarter)
        amp = 0.55 + 0.1 * bar_i
        for note, dur in zip(notes, durs):
            events.append((cursor, midi_freq(note), dur * 0.9, amp))
            cursor += dur
    stab_at = cursor + 0.02
    boom_at = stab_at + 0.15
    total = boom_at + 0.40
    buf = np.zeros(int(math.ceil((total + 0.02) * SR)))
    for at, freq, dur, amp in events:
        place(buf, horn_note(freq, dur, amp, rng), at)
        place(buf, horn_note(freq * 2.0 ** (6 / 1200), dur * 0.85, amp * 0.4, rng), at)
    for note, amp in ((77, 0.85), (82, 0.72), (86, 0.6)):
        place(buf, horn_note(midi_freq(note), 0.16, amp, rng), stab_at)
    n = int(round(0.38 * SR))
    t = np.arange(n) / SR
    freq = 92.0 * np.exp(-t * 5.5) + 36.0
    phase = 2.0 * math.pi * np.cumsum(freq) / SR
    body = np.sin(phase) * np.exp(-t * 3.0)
    body += 0.45 * np.sin(phase * 0.5) * np.exp(-t * 2.0)
    crack = rng.standard_normal(n) * np.exp(-t * 40.0) * 0.55
    boom = (body + crack) * np.linspace(1.0, 0.0, n)
    place(buf, boom * 0.95, boom_at)
    peak = float(np.max(np.abs(buf))) or 1.0
    buf *= 0.92 / peak
    fade = int(0.004 * SR)
    buf[:fade] *= np.linspace(0.0, 1.0, fade)
    buf[-fade:] *= np.linspace(1.0, 0.0, fade)
    return buf


def synthesize_end() -> np.ndarray:
    dur = 0.82
    buf = np.zeros(int(round(dur * SR)))

    def bell(freq: float, length: float, amp: float) -> np.ndarray:
        n = int(round(length * SR))
        t = np.arange(n) / SR
        env = (1.0 - np.exp(-t / 0.012)) * np.exp(-t * 3.6)
        tone = np.sin(2.0 * math.pi * freq * t)
        tone += 0.18 * np.sin(2.0 * math.pi * freq * 2.01 * t)
        return tone * env * amp

    place(buf, bell(880.0, 0.55, 0.42), 0.0)
    place(buf, bell(659.25, 0.48, 0.36), 0.36)
    peak = float(np.max(np.abs(buf))) or 1.0
    buf *= 0.48 / peak
    fade = int(0.006 * SR)
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


def main() -> None:
    write_wav(OUT / "go.wav", synthesize_go())
    write_wav(OUT / "end.wav", synthesize_end())
    for name in ("go.wav", "end.wav"):
        path = OUT / name
        with wave.open(str(path), "r") as handle:
            seconds = handle.getnframes() / handle.getframerate()
        print(f"{name} {seconds:.3f}s {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
