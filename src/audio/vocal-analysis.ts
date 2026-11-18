function mono(channels: Float32Array[]): Float32Array {
  if (!channels.length) return new Float32Array();
  if (channels.length === 1) return channels[0] ?? new Float32Array();
  const length = Math.min(...channels.map((channel) => channel.length));
  const output = new Float32Array(length);
  for (const channel of channels) {
    for (let index = 0; index < length; index++) output[index] += (channel[index] ?? 0) / channels.length;
  }
  return output;
}