#!/usr/bin/env python3
"""Synthesize an original rider match chime.

Short warm rising chime under 400 ms (G4–B4–D5), the same family as the
driver GO cue. Soft attack, exponential decay, no sampled material.
Writes a 44.1 kHz WAV master and an AAC M4A normalized near -16 LUFS
with true peak at or below -1 dBTP.
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
DURATION = 0.36
# G4, B4, D5. Warm rising triad, same family as the driver GO chime.
NOTES = (
    (392.00, 0.00, 0.55),
    (493.88, 0.08, 0.62),
    (587.33, 0.16, 0.70),
)
PARTIALS = (
    (1.0, 1.00, 0.42),
    (2.0, 0.16, 0.16),
    (3.0, 0.045, 0.09),
)
ATTACK_S = 0.028
OUT_DIR = Path(__file__).resolve().parents[1] / 'apps' / 'rider' / 'assets' / 'sounds'


def raised_cosine(n: int, attack: int) -> np.ndarray:
    env = np.ones(n, dtype=np.float64)
    a = min(attack, n)
    if a <= 1:
        return env
    env[:a] = 0.5 * (1.0 - np.cos(np.linspace(0.0, math.pi, a, endpoint=False)))
    return env


def bell(freq: float, amp: float, n: int) -> np.ndarray:
    t = np.arange(n, dtype=np.float64) / SR
    attack = raised_cosine(n, int(ATTACK_S * SR))
    tone = np.zeros(n, dtype=np.float64)
    for ratio, partial_amp, decay in PARTIALS:
        # A few cents of stretch keeps the partial from sounding like a buzzer.
        stretched = freq * ratio * (1.0 + 0.0015 * (ratio - 1.0))
        env = np.exp(-t / decay) * attack
        tone += partial_amp * np.sin(2.0 * math.pi * stretched * t) * env
    return tone * amp


def delay(x: np.ndarray, samples: int) -> np.ndarray:
    if samples <= 0:
        return x.copy()
    y = np.zeros_like(x)
    y[samples:] = x[:-samples]
    return y


def one_pole(x: np.ndarray, coeff: float) -> np.ndarray:
    y = np.empty_like(x)
    acc = 0.0
    for i, sample in enumerate(x):
        acc += coeff * (sample - acc)
        y[i] = acc
    return y


def lowpass(x: np.ndarray, freq: float, q: float = 0.707) -> np.ndarray:
    w0 = 2.0 * math.pi * freq / SR
    alpha = math.sin(w0) / (2.0 * q)
    cosw = math.cos(w0)
    b0 = (1.0 - cosw) / 2.0
    b1 = 1.0 - cosw
    b2 = (1.0 - cosw) / 2.0
    a0 = 1.0 + alpha
    a1 = -2.0 * cosw
    a2 = 1.0 - alpha
    b0, b1, b2, a1, a2 = (c / a0 for c in (b0, b1, b2, a1, a2))
    y = np.empty_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, xn in enumerate(x):
        yn = b0 * xn + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1 = x1, xn
        y2, y1 = y1, yn
        y[i] = yn
    return y


def gentle_reverb(dry: np.ndarray) -> np.ndarray:
    reflections = (
        (0.013, 0.16),
        (0.023, 0.12),
        (0.037, 0.08),
        (0.053, 0.055),
        (0.079, 0.035),
        (0.107, 0.022),
    )
    early = np.zeros_like(dry)
    for seconds, gain in reflections:
        early += gain * delay(dry, int(seconds * SR))
    damped = one_pole(early, 0.18)
    loop = int(0.061 * SR)
    tail = np.zeros_like(dry)
    state = 0.0
    feedback = 0.22
    for i, sample in enumerate(damped):
        inp = sample
        if i >= loop:
            inp += feedback * state
        state += 0.16 * (inp - state)
        tail[i] = state
    return dry * 0.84 + tail * 0.42


def synthesize() -> np.ndarray:
    n = int(DURATION * SR)
    mix = np.zeros(n, dtype=np.float64)
    for freq, start, amp in NOTES:
        begin = int(start * SR)
        mix[begin:] += bell(freq, amp, n - begin)
    mix = gentle_reverb(mix)
    mix = lowpass(mix, 7800.0)
    fade_in = int(0.004 * SR)
    fade_out = int(0.045 * SR)
    mix[:fade_in] *= np.linspace(0.0, 1.0, fade_in)
    mix[-fade_out:] *= np.linspace(1.0, 0.0, fade_out)
    peak = np.max(np.abs(mix))
    if peak > 0:
        mix *= 0.45 / peak
    return mix


def write_wav(path: Path, samples: np.ndarray) -> None:
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16)
    with wave.open(str(path), 'wb') as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes(pcm.tobytes())


def run(cmd: list[str]) -> str:
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return result.stderr + result.stdout


def loudnorm_stats(path: Path) -> dict:
    log = run([
        'ffmpeg', '-hide_banner', '-i', str(path),
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:linear=true:print_format=json',
        '-f', 'null', '-',
    ])
    start = log.rfind('{')
    end = log.rfind('}')
    if start < 0 or end < start:
        raise RuntimeError(f'loudnorm stats missing:\n{log}')
    return json.loads(log[start:end + 1])


def apply_loudnorm(src: Path, dst: Path, stats: dict) -> None:
    measured = (
        f"loudnorm=I=-16:TP=-1.5:LRA=11:linear=true:"
        f"measured_I={stats['input_i']}:"
        f"measured_TP={stats['input_tp']}:"
        f"measured_LRA={stats['input_lra']}:"
        f"measured_thresh={stats['input_thresh']}:"
        f"offset={stats['target_offset']}"
    )
    run([
        'ffmpeg', '-y', '-hide_banner', '-i', str(src),
        '-af', measured,
        '-ar', str(SR), '-ac', '1', '-c:a', 'pcm_s16le',
        str(dst),
    ])


def encode_m4a(src: Path, dst: Path) -> None:
    run([
        'ffmpeg', '-y', '-hide_banner', '-i', str(src),
        '-c:a', 'aac', '-b:a', '160k', '-ar', str(SR), '-ac', '1',
        str(dst),
    ])


def measure(path: Path) -> None:
    log = run([
        'ffmpeg', '-hide_banner', '-i', str(path),
        '-af', 'ebur128=peak=true,astats=measure_overall=Peak_level',
        '-f', 'null', '-',
    ])
    interesting = [
        line.strip() for line in log.splitlines()
        if 'I:' in line or 'Peak:' in line or 'true peak' in line.lower() or 'Peak level' in line
    ]
    print(path.name)
    print('\n'.join(interesting[-12:]))


def main() -> None:
    if shutil.which('ffmpeg') is None:
        raise SystemExit('ffmpeg is required')
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    raw = OUT_DIR / 'match-chime.raw.wav'
    wav = OUT_DIR / 'match-chime.wav'
    m4a = OUT_DIR / 'match-chime.m4a'
    write_wav(raw, synthesize())
    stats = loudnorm_stats(raw)
    print('measured', {k: stats[k] for k in ('input_i', 'input_tp', 'input_lra', 'target_offset')})
    if stats.get('input_i') in (None, '-inf', 'inf') or stats.get('target_offset') in ('inf', '-inf'):
        # Under 400 ms there is no integrated LUFS gate. Hold the peak at -1 dBTP.
        ceiling = 10 ** (-1.0 / 20.0)
        with wave.open(str(raw), 'rb') as handle:
            frames = np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16).astype(np.float64)
        peak = float(np.max(np.abs(frames))) or 1.0
        scaled = np.clip(frames * (ceiling * 32767.0 / peak), -32767, 32767)
        write_wav(wav, scaled / 32767.0)
        print('peak-ceiling -1 dBTP')
    else:
        apply_loudnorm(raw, wav, stats)
    raw.unlink()
    encode_m4a(wav, m4a)
    measure(wav)
    measure(m4a)


if __name__ == '__main__':
    main()
