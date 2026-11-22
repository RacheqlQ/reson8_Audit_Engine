import { describe, expect, it } from "vitest";
import { analyzePcm, estimateTempo } from "../src/audio/sonic-dna.js";
import { analyzeVocalSignalDiagnostics } from "../src/audio/vocal-signal-diagnostics.js";

function pulse(bpm:number,seconds=12,sampleRate=8000):Float32Array {
 const samples=new Float32Array(sampleRate*seconds);
 for(let beat=0;beat<seconds*bpm/60;beat++){
  const start=Math.round(beat*60/bpm*sampleRate),accent=bpm===126&&beat%2!==0?0.35:1;
  const length=Math.min(Math.round(sampleRate*0.03),samples.length-start);
  for(let i=0;i<length;i++)samples[start+i]+=accent*Math.sin(2*Math.PI*220*i/sampleRate)*Math.exp(-i/(sampleRate*0.004));
 }
 return samples;
}
function syncopatedSwingPulse(bpm:number,seconds=12,sampleRate=8000):Float32Array {
 const samples=new Float32Array(sampleRate*seconds),interval=60/bpm;
 const add=(time:number,accent:number)=>{
  const start=Math.round(time*sampleRate),length=Math.min(Math.round(sampleRate*0.025),samples.length-start);
  for(let i=0;i<length;i++)samples[start+i]+=accent*Math.sin(2*Math.PI*220*i/sampleRate)*Math.exp(-i/(sampleRate*0.004));
 };
 for(let beat=0;beat<seconds*bpm/60;beat++){
  const time=beat*interval+(beat%2?interval*0.03:0);
  add(time,beat%2?0.55:1);
  if(beat%3===1)add(beat*interval+interval*0.48,0.12);
 }
 return samples;
}
function chord(freqs:number[],seconds=6,sampleRate=8000):Float32Array {
 return Float32Array.from({length:sampleRate*seconds},(_,i)=>freqs.reduce((sum,f)=>sum+Math.sin(2*Math.PI*f*i/sampleRate),0)/freqs.length);
}
function progression(chords:number[][],secondsPerChord=2,sampleRate=8000):Float32Array {
 const segmentLength=sampleRate*secondsPerChord,output=new Float32Array(segmentLength*chords.length);
 chords.forEach((frequencies,chordIndex)=>{
  for(let i=0;i<segmentLength;i++){
   let value=0;
   for(const frequency of frequencies)value+=Math.sin(2*Math.PI*frequency*i/sampleRate);
   output[chordIndex*segmentLength+i]=value/Math.max(1,frequencies.length)*0.28;
  }
 });
 return output;
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
 it("uses transient-onset evidence and exposes ranked tempo candidates with an abstention diagnostic",()=>{
  const result=estimateTempo(pulse(120),8000);
  expect(result.method).toBe("high_frequency_transient_autocorrelation");
  expect(result.candidateBpms).toContain(120);
  expect(result.abstentionReason).toBeNull();
 });
 it("abstains on sustained non-rhythmic noise instead of reporting an arbitrary tempo",()=>{
  let seed=17;
  const noise=Float32Array.from({length:8000*8},()=>{seed=(seed*16807)%2147483647;return ((seed/2147483647)*2-1)*0.08;});
  const result=estimateTempo(noise,8000);
  expect(result.bpm).toBeNull();
  expect(result.abstentionReason).not.toBeNull();
 });
 it("estimates a regular 120 BPM pulse",()=>{
  const result=estimateTempo(pulse(120),8000);
  expect(result.bpm).toBeGreaterThanOrEqual(115);
  expect(result.bpm).toBeLessThanOrEqual(125);
  expect(result.confidence).not.toBeNull();
 });
 it("tracks a swung and syncopated 120 BPM pulse without locking to offbeat accents",()=>{
  const result=estimateTempo(syncopatedSwingPulse(120),8000);
  expect(result.bpm===60||(result.bpm!==null&&result.bpm>=115&&result.bpm<=125)||(result.topCandidateBpm!==null&&result.topCandidateBpm>=115&&result.topCandidateBpm<=125)).toBe(true);
  expect(result.candidateBpms.some(candidate=>candidate>=115&&candidate<=125)).toBe(true);
  expect(result.abstentionReason).not.toBeNull();
 });
 it("includes the half-time tempo candidate when the beat pulse supports it",()=>{
  const result=estimateTempo(pulse(120),8000);
  expect(result.candidateBpms).toContain(60);
 });
 it("reports 126 BPM with 63 BPM as its half-time alternative",()=>{
  const result=estimateTempo(pulse(126),8000);
  expect(result.bpm).toBeNull();
  expect(result.topCandidateBpm).toBe(126);
  expect(result.alternateTempo).toBe(63);
  expect(result.voting.confirmation_status).toBe("CANDIDATE");
  expect(result.voting.reason_codes).toContain("LOW_TRANSIENT_PROMINENCE");
 });
 it("detects C major from a sustained C major triad",()=>{
  const result=analyzePcm(chord([261.6256,329.6276,391.9954]),8000);
  expect(result.key).toBeNull();
  expect(result.mode).toBeNull();
  expect(result.tonalResolution?.status).toBe("PROVISIONAL");
  expect(result.tonalResolution?.tonic).toBe("C");
  expect(result.keyConfidence).toBeGreaterThan(0);
 });
 it("detects A minor from a sustained A minor triad",()=>{
  const result=analyzePcm(chord([220,261.6256,329.6276]),8000);
  expect(result.key).toBeNull();
  expect(result.mode).toBeNull();
  expect(result.tonalResolution?.tonic).toBe("A");
  expect(result.tonalResolution?.mode).toBe("minor");
 });
 it("uses bass-root and neighbouring-fifth support to identify a stable C-major chord progression",()=>{
  const cMajorProgression=[
   [65.4064,164.8138,196.0,261.6256],
   [87.3071,110.0,130.8128,174.6141],
   [98.0,123.4708,146.8324,195.9977],
   [65.4064,164.8138,196.0,261.6256]
  ];
  const result=analyzePcm(progression([...cMajorProgression,...cMajorProgression,...cMajorProgression],4),8000);
  expect(result.key).toBe("C");
  expect(result.mode).toBe("major");
  expect(result.tonalResolution?.status).toBe("CONFIRMED");
 },20000);it("withholds a single key when sustained sections disagree tonally",()=>{
  const first=chord([261.6256,329.6276,391.9954],18);
  const second=chord([369.9944,466.1638,554.3653],18);
  const combined=new Float32Array(first.length+second.length);
  combined.set(first);combined.set(second,first.length);
  const result=analyzePcm(combined,8000);
  expect(result.key).toBeNull();
  expect(result.mode).toBeNull();
  expect(result.limitations.some((item)=>item.includes("stable window consensus"))).toBe(true);
 },15000);
 it("returns null key and tempo with limitation notes for silence",()=>{
  const result=analyzePcm(new Float32Array(48000),8000);
  expect(result.key).toBeNull();
  expect(result.mode).toBeNull();
  expect(result.bpm).toBeNull();
  expect(result.acousticFeatureProfile.status).toBe("insufficient_evidence");
  expect(result.limitations.some((item)=>item.includes("NO_MEASURABLE_SIGNAL"))).toBe(true);
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
  expect(key.key).toBeNull();
  expect(key.mode).toBeNull();
  expect(key.tonalResolution?.tonic).toBe("C");
  expect(key.keyConfidence).toBeGreaterThan(0);
 });
 it("keeps six-minute 44.1 kHz analysis bounded while retaining a tempo candidate, chroma and spectral measurements",()=>{
  const sampleRate=44100,samples=pulse(120,360,sampleRate);
  const chordLoop=Float32Array.from({length:2048},(_,i)=>(
   Math.sin(2*Math.PI*12*i/2048)+Math.sin(2*Math.PI*15*i/2048)+Math.sin(2*Math.PI*18*i/2048)
  )/3);
  for(let i=0;i<samples.length;i++)samples[i]+=0.1*chordLoop[i%chordLoop.length];
  const result=analyzePcm(samples,sampleRate);
  expect(result.durationSeconds).toBe(360);
  expect(result.bpm).toBeNull();
  expect(result.tempoCandidateBpm).toBe(120);
  expect(result.rhythmFeatures.tempoVerdict.reason_codes).toContain("LOW_VOTE_CONSENSUS_OR_MARGIN");
  expect(result.key).toBe("C");
  expect(result.mode).toBe("major");
  expect(result.keyConfidence).toBeGreaterThan(0);
  expect(result.spectralCentroidHz).toBeGreaterThan(0);
  expect(result.zeroCrossingRate).toBeGreaterThan(0);
 });

 it("measures upper spectral bins instead of returning zero for high-frequency PCM",()=>{
  const sampleRate=48000,samples=Float32Array.from({length:sampleRate*2},(_,i)=>Math.sin(2*Math.PI*5000*i/sampleRate));
  const result=analyzePcm(samples,sampleRate);
  expect(result.spectralCentroidHz).toBeGreaterThan(4800);
  expect(result.spectralCentroidHz).toBeLessThan(5200);
 });
 it("does not invent a tempo for steady DC or a sustained sine wave",()=>{
  const dc=new Float32Array(8000*8).fill(0.25);
  const tone=Float32Array.from({length:8000*8},(_,i)=>Math.sin(2*Math.PI*440*i/8000));
  expect(estimateTempo(dc,8000).bpm).toBeNull();
  expect(estimateTempo(tone,8000).bpm).toBeNull();
 });
 it("exposes provisional audio-derived mood and energy while keeping spectral measurements as signal descriptors",()=>{
  const sampleRate=8000;
  const bright=Float32Array.from({length:sampleRate*2},(_,i)=>0.3*Math.sin(2*Math.PI*3500*i/sampleRate));
  const result=analyzePcm(bright,sampleRate);
  const {mood,energy}=result.acousticFeatureProfile.predictions;
  expect(result.acousticFeatureProfile.status).toBe("measured");
  expect(mood.status).toBe("provisional");
  expect(mood.method).toBe("audio_feature_heuristics_v1");
  expect(mood.probability).toBeNull();
  expect(result.moodTags).toEqual(mood.labels);
  expect(energy.status).toBe("provisional");
  expect(energy.method).toBe("audio_feature_heuristics_v1");
  expect(energy.probability).toBeNull();
  expect(energy.score).toBeGreaterThanOrEqual(0);
  expect(energy.score).toBeLessThanOrEqual(100);
  expect(result.spectralCentroidHz).toBeGreaterThan(3000);
  expect(result.acousticFeatureProfile.descriptors.spectralCentroidHz.unit).toBe("Hz");
  expect(Number.isFinite(result.rmsLevelDbfs)).toBe(true);
 });

 it("does not assert genre from tempo alone",()=>{
  const result=analyzePcm(pulse(112),8000);
  expect(result.genreContext).toEqual([]);
 });

 it("labels the RMS-derived signal level as dBFS and does not claim integrated LUFS",()=>{
  const sampleRate=8000;
  const samples=Float32Array.from({length:sampleRate*2},(_,i)=>0.25*Math.sin(2*Math.PI*440*i/sampleRate));
  const result=analyzePcm(samples,sampleRate);
  expect(result.loudnessLufs).toBeNull();
  expect((result as unknown as {rmsLevelDbfs:number}).rmsLevelDbfs)
   .toBeCloseTo(20*Math.log10(result.rmsEnergy),5);
 });
 it("returns explicit rhythm and harmonic measurements while marking vocal analysis unavailable",()=>{
  const sampleRate=8000;
  const rhythm=analyzePcm(pulse(120,12,sampleRate),sampleRate);
  const harmonic=analyzePcm(chord([261.6256,329.6276,391.9954],12,sampleRate),sampleRate);
  expect(rhythm.rhythmFeatures).toMatchObject({status:"measured",method:"high_frequency_transient_autocorrelation"});
  expect(rhythm.rhythmFeatures.bpm).toBeGreaterThanOrEqual(115);
  expect(rhythm.rhythmFeatures.bpm).toBeLessThanOrEqual(125);
  expect(harmonic.harmonicFeatures).toMatchObject({status:"measured",key:null,mode:null,method:"fft_harmonic_chroma_ensemble"});
  expect(harmonic.tonalResolution?.status).toBe("PROVISIONAL");
  expect(harmonic.tonalResolution?.tonic).toBe("C");
  expect(rhythm.vocalFeatures).toMatchObject({status:"signal_diagnostics_only",method:"autocorrelation_voiced_periodicity",voicePresence:"undetermined"});
  expect(rhythm.vocalFeatures.limitations).toEqual(expect.arrayContaining([expect.stringContaining("not proof of human vocals")]));
 });

});

describe("vocal signal diagnostics",()=>{
 it("reports voice-range periodicity candidates without claiming vocal presence",()=>{
  const sampleRate=8000;
  const tone=Float32Array.from({length:sampleRate*3},(_,i)=>0.2*Math.sin(2*Math.PI*220*i/sampleRate));
  const result=analyzeVocalSignalDiagnostics(tone,sampleRate);
  expect(result.status).toBe("signal_diagnostics_only");
  expect(result.periodicFrames).toBeGreaterThan(0);
  expect(result.medianFundamentalHz).toBeGreaterThan(180);
  expect(result.medianFundamentalHz).toBeLessThan(260);
  expect(result.voicePresence).toBe("undetermined");
  expect(result.limitations.join(" ")).toContain("not proof of human vocals");
 });
 it("abstains on silence and short input",()=>{
  expect(analyzeVocalSignalDiagnostics(new Float32Array(8000*2),8000).status).toBe("insufficient_evidence");
  expect(analyzeVocalSignalDiagnostics(new Float32Array(800),8000).status).toBe("insufficient_evidence");
 });
});
