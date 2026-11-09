import { describe, expect, it } from "vitest";
import { analyzePcm, classifyGenreFromBpm, estimateTempo } from "../src/audio/sonic-dna.js";

function pulse(bpm:number,seconds=12,sampleRate=8000):Float32Array {
 const samples=new Float32Array(sampleRate*seconds);
 for(let beat=0;beat<seconds*bpm/60;beat++){
  const start=Math.round(beat*60/bpm*sampleRate),accent=bpm===126&&beat%2!==0?0.35:1;
  const length=Math.min(Math.round(sampleRate*0.03),samples.length-start);
  for(let i=0;i<length;i++)samples[start+i]+=accent*Math.sin(2*Math.PI*220*i/sampleRate)*Math.exp(-i/(sampleRate*0.004));
 }
 return samples;
}
function chord(freqs:number[],seconds=6,sampleRate=8000):Float32Array {
 return Float32Array.from({length:sampleRate*seconds},(_,i)=>freqs.reduce((sum,f)=>sum+Math.sin(2*Math.PI*f*i/sampleRate),0)/freqs.length);
}
function interleaveStereo(mono:Float32Array):Float32Array {
 const stereo=new Float32Array(mono.length*2);
 for(let i=0;i<mono.length;i++){stereo[i*2]=mono[i];stereo[i*2+1]=mono[i]*0.8;}
 return stereo;
}

describe("Sonic DNA",()=>{
 it("measures spectral centroid and zero crossings on bipolar PCM",()=>{
  const sampleRate=8000,samples=Float32Array.from({length:sampleRate},(_,i)=>Math.sin(2*Math.PI*440*i/sampleRate));
  const result=analyzePcm(samples,sampleRate);
  expect(result.spectralCentroidHz).toBeGreaterThan(400);
  expect(result.spectralCentroidHz).toBeLessThan(500);
  expect(result.zeroCrossingRate).toBeGreaterThan(0.05);
 });
 it("estimates a regular 120 BPM pulse",()=>{
  const result=estimateTempo(pulse(120),8000);
  expect(result.bpm).toBeGreaterThanOrEqual(115);
  expect(result.bpm).toBeLessThanOrEqual(125);
  expect(result.confidence).not.toBeNull();
 });
 it("reports 126 BPM with 63 BPM as its half-time alternative",()=>{
  const result=estimateTempo(pulse(126),8000);
  expect(result.bpm).toBeGreaterThanOrEqual(122);
  expect(result.bpm).toBeLessThanOrEqual(130);
  expect(result.alternateTempo).toBe(63);
 });
 it("detects C major from a sustained C major triad",()=>{
  const result=analyzePcm(chord([261.6256,329.6276,391.9954]),8000);
  expect(result.key).toBe("C");
  expect(result.mode).toBe("major");
  expect(result.keyConfidence).toBeGreaterThan(0);
 });
 it("detects A minor from a sustained A minor triad",()=>{
  const result=analyzePcm(chord([220,261.6256,329.6276]),8000);
  expect(result.key).toBe("A");
  expect(result.mode).toBe("minor");
 });
 it("returns null key and tempo with limitation notes for silence",()=>{
  const result=analyzePcm(new Float32Array(48000),8000);
  expect(result.key).toBeNull();
  expect(result.mode).toBeNull();
  expect(result.bpm).toBeNull();
  expect(result.limitations.length).toBeGreaterThan(0);
 });
 it.each([
  {sampleRate:44100,channels:1},
  {sampleRate:44100,channels:2},
  {sampleRate:48000,channels:1},
  {sampleRate:48000,channels:2},
 ])("keeps chroma and tempo measurements for $sampleRate Hz, $channels-channel PCM",({sampleRate,channels})=>{
  const monoPulse=pulse(120,12,sampleRate),monoChord=chord([261.6256,329.6276,391.9954],6,sampleRate);
  const pulseInput=channels===2?interleaveStereo(monoPulse):monoPulse;
  const chordInput=channels===2?interleaveStereo(monoChord):monoChord;
  const tempo=analyzePcm(pulseInput,sampleRate,channels);
  const key=analyzePcm(chordInput,sampleRate,channels);
  expect(tempo.durationSeconds).toBe(12);
  expect(tempo.channels).toBe(channels);
  expect(tempo.bpm).toBeGreaterThanOrEqual(115);
  expect(tempo.bpm).toBeLessThanOrEqual(125);
  expect(tempo.zeroCrossingRate).toBeGreaterThan(0);
  expect(tempo.spectralCentroidHz).toBeGreaterThan(0);
  expect(key.key).toBe("C");
  expect(key.mode).toBe("major");
  expect(key.keyConfidence).toBeGreaterThan(0);
 });
 it("keeps six-minute 44.1 kHz analysis bounded while retaining tempo and spectral measurements",()=>{
  const samples=pulse(120,360,44100),result=analyzePcm(samples,44100);
  expect(result.durationSeconds).toBe(360);
  expect(result.bpm).toBeGreaterThanOrEqual(115);
  expect(result.bpm).toBeLessThanOrEqual(125);
  expect(result.spectralCentroidHz).toBeGreaterThan(0);
  expect(result.zeroCrossingRate).toBeGreaterThan(0);
 });

 it("measures upper spectral bins instead of returning zero for high-frequency PCM",()=>{
  const sampleRate=48000,samples=Float32Array.from({length:sampleRate*2},(_,i)=>Math.sin(2*Math.PI*5000*i/sampleRate));
  const result=analyzePcm(samples,sampleRate);
  expect(result.spectralCentroidHz).toBeGreaterThan(4800);
  expect(result.spectralCentroidHz).toBeLessThan(5200);
 });
 it("does not invent a tempo for a steady non-rhythmic signal",()=>{
  expect(estimateTempo(new Float32Array(8000*8).fill(0.25),8000).bpm).toBeNull();
 });
 it("maps tempo to broad genre context without asserting genre as fact",()=>{
  expect(classifyGenreFromBpm(75)).toContain("R&B");
  expect(classifyGenreFromBpm(112)).toContain("Amapiano");
  expect(classifyGenreFromBpm(128)).toContain("Pop");
  expect(classifyGenreFromBpm(999)).toEqual([]);
 });
});
