export function getAudioContextConstructor(): typeof AudioContext | null {
  return (
    globalThis.AudioContext ??
    (
      globalThis as typeof globalThis & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext ??
    null
  );
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return globalThis.btoa(binary);
}

export function encodeAudioBufferToMonoPcm16WavBase64(
  audioBuffer: AudioBuffer,
): string {
  const channelCount = Math.max(1, audioBuffer.numberOfChannels);
  const frameCount = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const channels = Array.from({ length: channelCount }, (_, index) =>
    audioBuffer.getChannelData(index),
  );
  const samples = new Float32Array(frameCount);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    samples[frameIndex] =
      channels.reduce((sum, channel) => sum + channel[frameIndex], 0) /
      channelCount;
  }
  return encodeMonoPcmFloat32ToWavBase64(samples, sampleRate);
}

export function encodeMonoPcmFloat32ToWavBase64(
  samples: Float32Array,
  sampleRate: number,
): string {
  const frameCount = samples.length;
  const bytesPerSample = 2;
  const wavHeaderBytes = 44;
  const dataBytes = frameCount * bytesPerSample;
  const buffer = new ArrayBuffer(wavHeaderBytes + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);

  let writeOffset = wavHeaderBytes;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[frameIndex]));
    const sample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(writeOffset, Math.round(sample), true);
    writeOffset += bytesPerSample;
  }

  return bytesToBase64(new Uint8Array(buffer));
}
