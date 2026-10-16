// Measure ambient noise with the phone/laptop microphone for a few seconds.
// Audio never leaves the device — only the resulting dB number is shared.
// Phone mics aren't calibrated, so this is an estimate (±5–10 dB).

const CALIBRATION = 94; // dBFS → approx dB SPL for typical device mics

export async function measureNoise(seconds = 4, onProgress = () => {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone not available (needs https or localhost)');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new AudioContext();
  try {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const levels = [];
    const end = performance.now() + seconds * 1000;
    while (performance.now() < end) {
      await new Promise((r) => setTimeout(r, 100));
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length) || 1e-8;
      levels.push(20 * Math.log10(rms) + CALIBRATION);
      onProgress(1 - (end - performance.now()) / (seconds * 1000));
    }
    // Median ignores a single cough or door slam.
    levels.sort((a, b) => a - b);
    const median = levels[Math.floor(levels.length / 2)];
    return Math.round(Math.max(20, Math.min(100, median)));
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
  }
}
