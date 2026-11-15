import { estimateKey } from "./key-estimation.js";
import type { GenreFusionResult } from "../genre/fusion.js";
export interface TempoEstimate {
 bpm:number|null;
 alternateTempo:number|null;
 confidence:number|null;
 method:"high_frequency_transient_autocorrelation";
 candidateBpms:number[];
 abstentionReason:string|null;
}
export interface SonicDnaFeatures {
 sampleRate:number; channels:number; durationSeconds:number; rhythmFeatures:Record<string,unknown>; harmonicFeatures:Record<string,unknown>; vocalFeatures:Record<string,unknown>; bpm:number|null; alternateTempo:number|null; tempoConfidence:number|null;
 key:string|null; mode:"major"|"minor"|null; keyConfidence:number|null; keyTuningCents:number|null; keySegmentAgreement:number|null; keyAnalysisFftButterflyCount:number; limitations:string[];
 loudnessLufs:number|null; rmsLevelDbfs:number; rmsEnergy:number; dynamicRangeDb:number; spectralCentroidHz:number; spectralBandwidthHz:number;
 spectralRolloffHz:number; zeroCrossingRate:number; moodTags:string[]; genreContext:string[]; genreClassification?: GenreFusionResult;
}
const EPSILON=1e-12, MAX_ANALYSIS_SAMPLES=3_000_000, NOTES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
function rms(s:Float32Array):number { if(!s.length)return 0; let sum=0; for(const x of s)sum+=x*x; return Math.sqrt(sum/s.length); }
function percentile(a:number[],p:number):number { if(!a.length)return 0; const i=(a.length-1)*p,l=Math.floor(i),u=Math.ceil(i); return l===u?a[l]:a[l]+(a[u]-a[l])*(i-l); }
const clamp=(v:number)=>Math.max(0,Math.min(1,v));

/**
 * Convert interleaved PCM to a mono analysis signal and keep the analysis
 * array at or below MAX_ANALYSIS_SAMPLES. Block averaging is a small
 * anti-aliasing low-pass filter; selecting every Nth sample would fold
 * high-frequency energy into the chroma/tempo bands on long recordings.
 */
function prepareAnalysisPcm(samples:Float32Array,sampleRate:number,channels:number):{samples:Float32Array;sampleRate:number;durationSeconds:number} {
 const channelCount=Number.isInteger(channels)&&channels>0?channels:1;
 const frameCount=Math.floor(samples.length/channelCount);
 const stride=Math.max(1,Math.ceil(frameCount/MAX_ANALYSIS_SAMPLES));
 const outputFrames=Math.ceil(frameCount/stride);
 const durationSeconds=sampleRate>0?frameCount/sampleRate:0;
 if(channelCount===1&&stride===1&&frameCount===samples.length)return {samples,sampleRate,durationSeconds};
 const mono=new Float32Array(outputFrames);
 for(let out=0;out<outputFrames;out++){
  const first=out*stride,last=Math.min(frameCount,first+stride);
  let blockSum=0;
  for(let frame=first;frame<last;frame++){
   let frameSum=0;
   const offset=frame*channelCount;
   for(let channel=0;channel<channelCount;channel++)frameSum+=samples[offset+channel];
   blockSum+=frameSum/channelCount;
  }
  mono[out]=blockSum/Math.max(1,last-first);
 }
 return {samples:mono,sampleRate:sampleRate/stride,durationSeconds};
}


function emptyTempoEstimate(reason:string):TempoEstimate {
 return {bpm:null,alternateTempo:null,confidence:null,method:"high_frequency_transient_autocorrelation",candidateBpms:[],abstentionReason:reason};
}

/**
 * Estimate tempo from high-frequency transient flux rather than raw block
 * loudness. The short-time absolute derivative emphasizes attacks and
 * de-emphasizes sustained tones. Confidence is a signal-prominence diagnostic,
 * not a calibrated probability of BPM accuracy.
 */
export function estimateTempo(samples:Float32Array,sampleRate:number):TempoEstimate {
 const method="high_frequency_transient_autocorrelation" as const;
 if(sampleRate<=0||samples.length<sampleRate*4||rms(samples)<1e-5)
  return emptyTempoEstimate("Insufficient duration or signal energy for tempo analysis.");
 const hop=Math.max(1,Math.floor(sampleRate/100));
 const onset:number[]=[];
 for(let start=0;start+hop<samples.length;start+=hop){
  let flux=0;
  const end=start+hop;
  for(let i=start+1;i<end;i++)flux+=Math.abs(samples[i]-samples[i-1]);
  onset.push(flux/hop);
 }
 if(onset.length<400)return emptyTempoEstimate("Insufficient onset frames for tempo analysis.");
 const novelty=onset.map((value,index)=>Math.max(0,value-(onset[index-1]??value)));
 const mean=novelty.reduce((sum,value)=>sum+value,0)/novelty.length;
 const variance=novelty.reduce((sum,value)=>sum+(value-mean)**2,0)/novelty.length;
 const sortedOnsets=[...onset].sort((a,b)=>a-b);
 const onsetPeakRatio=(sortedOnsets[Math.floor((sortedOnsets.length-1)*0.99)]??0)/Math.max(EPSILON,onset.reduce((sum,value)=>sum+value,0)/onset.length);
 if(mean<=EPSILON||Math.sqrt(variance)/Math.max(mean,EPSILON)<0.08||onsetPeakRatio<2.5)
  return emptyTempoEstimate("No sufficiently distinct transient activity was detected; sustained or noise-like signals are not assigned a tempo.");
 const scores=new Map<number,number>();
 for(let bpm=40;bpm<=240;bpm++){
  const lag=Math.max(1,Math.round(60/bpm*sampleRate/hop));
  const tolerance=Math.min(4,Math.max(1,Math.round(lag*0.08)));
  let bestScore=0;
  for(let offset=-tolerance;offset<=tolerance;offset++){
   const candidateLag=lag+offset;
   if(candidateLag<1)continue;
   let cross=0,left=0,right=0;
   for(let i=candidateLag;i<novelty.length;i++){
    const x=novelty[i],y=novelty[i-candidateLag];
    cross+=x*y;left+=x*x;right+=y*y;
   }
   bestScore=Math.max(bestScore,cross/Math.sqrt(Math.max(EPSILON,left*right)));
  }
  scores.set(bpm,bestScore);
 }
 const localPeaks=[...scores.entries()].filter(([bpm,score])=>
  score>=(scores.get(bpm-1)??-1)&&score>=(scores.get(bpm+1)??-1),
 ).sort((a,b)=>b[1]-a[1]);
 const selected:Array<[number,number]>=[];
 for(const candidate of localPeaks){
  if(selected.every(([bpm])=>Math.abs(bpm-candidate[0])>=4))selected.push(candidate);
  if(selected.length===5)break;
 }
 const bestBpm=selected[0]?.[0];
 const bestScore=selected[0]?.[1]??0;
 if(bestBpm===undefined||bestScore<0.08)
  return {...emptyTempoEstimate("Transient autocorrelation did not produce a sufficiently prominent tempo candidate."),candidateBpms:selected.map(([bpm])=>bpm)};
 const sortedScores=[...scores.values()].sort((a,b)=>a-b);
 const median=sortedScores[Math.floor(sortedScores.length/2)]??0;
 const confidence=clamp((bestScore-median)/Math.max(EPSILON,1-median));
 if(confidence<0.1)
  return {...emptyTempoEstimate("Tempo candidate prominence is too weak to support a reliable result."),confidence,candidateBpms:selected.map(([bpm])=>bpm)};
 const related=[0.5,1/3,2,3]
  .map(ratio=>({bpm:Math.round(bestBpm*ratio),score:scores.get(Math.round(bestBpm*ratio))??0}))
  .filter(candidate=>candidate.bpm>=40&&candidate.bpm<=240&&candidate.bpm!==bestBpm&&candidate.score>=bestScore*0.25)
  .sort((a,b)=>b.bpm-a.bpm);
 const relatedCandidate=related[0]??null;
 const bpm=relatedCandidate&&relatedCandidate.bpm>bestBpm?relatedCandidate.bpm:bestBpm;
 const alternateTempo=relatedCandidate?(bpm===bestBpm?relatedCandidate.bpm:bestBpm):null;
 const candidates=selected.map(([candidate])=>candidate);
 for(const candidate of [Math.round(bpm),Math.round(bpm)-1,Math.round(bpm)+1,...related.map(item=>item.bpm)])if(candidate>=40&&candidate<=240&&!candidates.includes(candidate))candidates.push(candidate);
 return {bpm,alternateTempo:alternateTempo===null?null:(bpm===bestBpm?alternateTempo:bestBpm),confidence,method,candidateBpms:candidates.slice(0,8),abstentionReason:null};
}

export function analyzePcm(samples:Float32Array,sampleRate:number,channels=1):SonicDnaFeatures {
 const prepared=prepareAnalysisPcm(samples,sampleRate,channels),a=prepared.samples,rate=prepared.sampleRate,energy=rms(a);
 let crossings=0;
 for(let i=1;i<a.length;i++)if((a[i-1]<0&&a[i]>=0)||(a[i-1]>=0&&a[i]<0))crossings++;
 const size=2048,bins=size/2,available=Math.max(1,Math.floor((a.length-size)/(size/2))+1),count=Math.min(12,available);
 let csum=0,bsum=0,rsum=0,used=0;
 for(let w=0;w<count;w++){
  const start=count===1?0:Math.floor(w*(available-1)/(count-1))*Math.floor(size/2);
  if(start+size>a.length)continue;
  const mags:number[]=[];let total=0,weighted=0;
  for(let b=1;b<=bins;b++){
   const hz=b*rate/size,angle=2*Math.PI*b/size,stepCos=Math.cos(angle),stepSin=Math.sin(angle);
   let re=0,im=0,cos=1,sin=0;
   for(let n=0;n<size;n++){
    const window=0.5-0.5*Math.cos(2*Math.PI*n/(size-1)),x=a[start+n]*window;
    re+=x*cos;im-=x*sin;
    const nextCos=cos*stepCos-sin*stepSin;
    sin=sin*stepCos+cos*stepSin;cos=nextCos;
   }
   const m=Math.hypot(re,im);mags.push(m);total+=m;weighted+=hz*m;
  }
  if(total<=EPSILON)continue;
  const centroid=weighted/total;let variance=0,cum=0,roll=0;
  for(let i=0;i<mags.length;i++){const hz=(i+1)*rate/size;variance+=(hz-centroid)**2*mags[i];cum+=mags[i];if(!roll&&cum>=total*0.85)roll=hz;}
  csum+=centroid;bsum+=Math.sqrt(variance/total);rsum+=roll;used++;
 }
 const centroid=used?csum/used:0,bandwidth=used?bsum/used:0,rolloff=used?rsum/used:0;
 const frames:number[]=[],frame=Math.max(256,Math.floor(rate*0.05));
 for(let s=0;s<a.length;s+=frame){const end=Math.min(a.length,s+frame);let sum=0;for(let i=s;i<end;i++)sum+=a[i]*a[i];frames.push(Math.sqrt(sum/Math.max(1,end-s)));}
 frames.sort((x,y)=>x-y);
 const p10=Math.max(EPSILON,percentile(frames,0.1)),p95=Math.max(p10,percentile(frames,0.95)),tempo=estimateTempo(a,rate),key=estimateKey(a,rate);
 const tags:string[]=[];
 if(energy>0.15)tags.push("High Energy");else if(energy<0.04)tags.push("Low Energy");else tags.push("Moderate Energy");
 if(crossings/Math.max(1,a.length-1)>0.08)tags.push("Bright/Noisy Texture");
 if(centroid>3000)tags.push("Bright Timbre");else if(centroid<1000)tags.push("Dark Timbre");
 const limitations:string[]=[];
 if(key.limitation)limitations.push(key.limitation);
 if(tempo.bpm===null)limitations.push("Tempo could not be determined reliably from the supplied audio.");
 return {
  sampleRate,channels:Number.isInteger(channels)&&channels>0?channels:1,durationSeconds:prepared.durationSeconds,
  rhythmFeatures:{status:tempo.bpm===null?"insufficient_evidence":"measured",bpm:tempo.bpm,alternateTempo:tempo.alternateTempo,confidence:tempo.confidence,method:tempo.method,candidateBpms:tempo.candidateBpms,abstentionReason:tempo.abstentionReason},
  harmonicFeatures:{status:key.key===null?"insufficient_evidence":"measured",key:key.key,mode:key.mode,confidence:key.confidence,method:key.method,tuningCents:key.tuningCents,segmentAgreement:key.segmentAgreement,analysisWindows:key.analysisWindows,fftButterflyCount:key.fftButterflyCount},
  vocalFeatures:{status:"not_analyzed",reason:"No vocal separation or vocal-activity model is configured; vocal attributes are not inferred."},
  bpm:tempo.bpm,alternateTempo:tempo.alternateTempo,tempoConfidence:tempo.confidence,
  key:key.key,mode:key.mode,keyConfidence:key.confidence,keyTuningCents:key.tuningCents,keySegmentAgreement:key.segmentAgreement,keyAnalysisFftButterflyCount:key.fftButterflyCount,limitations,
  loudnessLufs:null,rmsLevelDbfs:20*Math.log10(Math.max(EPSILON,energy)),rmsEnergy:energy,
  dynamicRangeDb:20*Math.log10(p95/p10),spectralCentroidHz:centroid,spectralBandwidthHz:bandwidth,
  spectralRolloffHz:rolloff,zeroCrossingRate:crossings/Math.max(1,a.length-1),
  moodTags:tags,genreContext:[]
 };
}
