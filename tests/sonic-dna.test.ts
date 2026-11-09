import { describe, expect, it } from "vitest";
import { analyzePcm, classifyGenreFromBpm, estimateTempo } from "../src/audio/sonic-dna.js";
function pulse(bpm:number,seconds=12,sampleRate=8000):Float32Array {const a=new Float32Array(sampleRate*seconds);for(let beat=0;beat<seconds*bpm/60;beat++){const start=Math.round(beat*60/bpm*sampleRate);for(let i=0;i<Math.min(sampleRate*0.02,a.length-start);i++){const accent=bpm===126&&beat%2!==0?0.35:1;a[start+i]+=accent*Math.exp(-i/18);}}return a;}
function chord(freqs:number[],seconds=6,sampleRate=8000):Float32Array{return Float32Array.from({length:sampleRate*seconds},(_,i)=>freqs.reduce((s,f)=>s+Math.sin(2*Math.PI*f*i/sampleRate),0)/freqs.length);}
describe("Sonic DNA",()=>{
 it("measures spectral centroid and zero crossings on the analysis array",()=>{const sr=8000,a=Float32Array.from({length:sr},(_,i)=>Math.sin(2*Math.PI*440*i/sr));const r=analyzePcm(a,sr);expect(r.spectralCentroidHz).toBeGreaterThan(400);expect(r.spectralCentroidHz).toBeLessThan(500);expect(r.zeroCrossingRate).toBeGreaterThan(0.05);});
 it("estimates a regular 120 BPM pulse",()=>{const r=estimateTempo(pulse(120),8000);expect(r.bpm).toBeGreaterThanOrEqual(115);expect(r.bpm).toBeLessThanOrEqual(125);expect(r.confidence).not.toBeNull();});
 it("reports 126 BPM with 63 BPM as its half-time alternative",()=>{const r=estimateTempo(pulse(126),8000);expect(r.bpm).toBeGreaterThanOrEqual(122);expect(r.bpm).toBeLessThanOrEqual(130);expect(r.alternateTempo).toBe(63);});
 it("detects C major from a sustained C major triad",()=>{const r=analyzePcm(chord([261.6256,329.6276,391.9954]),8000);expect(r.key).toBe("C");expect(r.mode).toBe("major");expect(r.keyConfidence).toBeGreaterThan(0);});
 it("detects A minor from a sustained A minor triad",()=>{const r=analyzePcm(chord([220,261.6256,329.6276]),8000);expect(r.key).toBe("A");expect(r.mode).toBe("minor");});
 it("returns null key and tempo with limitation notes for silence",()=>{const r=analyzePcm(new Float32Array(48000),8000);expect(r.key).toBeNull();expect(r.mode).toBeNull();expect(r.bpm).toBeNull();expect(r.limitations.length).toBeGreaterThan(0);});
 it("keeps long-track analysis bounded to about three million samples",()=>{const a=pulse(120,450),r=analyzePcm(a,8000);expect(r.durationSeconds).toBe(450);expect(r.bpm).not.toBeNull();expect(r.zeroCrossingRate).toBeGreaterThan(0);});
 it("maps tempo to broad genre context without asserting genre as fact",()=>{expect(classifyGenreFromBpm(75)).toContain("R&B");expect(classifyGenreFromBpm(112)).toContain("Amapiano");expect(classifyGenreFromBpm(128)).toContain("Pop");expect(classifyGenreFromBpm(999)).toEqual([]);});
});
