import { estimateKey, MIN_RELIABLE_KEY_CONFIDENCE, MIN_KEY_SEGMENT_AGREEMENT, type KeyEstimate } from "./key-estimation.js";
import { estimateGoertzelKey, estimateLowFrequencyEnvelopeTempo, type IndependentKeyEstimate, type IndependentTempoEstimate } from "./independent-estimators.js";
import { bootstrapCategoricalConsensus, type BootstrapConsensusDiagnostics } from "./ensemble-consensus.js";

export const MIN_RELIABLE_TEMPO_CONFIDENCE = 0.5;
import { analyzeVocalSignalDiagnostics } from "./vocal-signal-diagnostics.js";
import { extractAcousticFeatureProfile, type AcousticFeatureProfile } from "./acoustic-features.js";
import type { GenreFusionResult } from "../genre/fusion.js";
export interface TempoEstimate {
 bpm:number|null;
 topCandidateBpm:number|null;
 alternateTempo:number|null;
 confidence:number|null;
 method:"high_frequency_transient_autocorrelation";
 candidateBpms:number[];
 candidateScores:Array<{bpm:number;score:number}>;
 onsetEnvelope:number[];
 beatTimesSeconds:number[];
 downbeatCandidateTimesSeconds:number[];
 beatGridStatus:"tentative"|"not_determined";
 downbeatGridAssumption:"four-beat grouping for diagnostics only"|null;
 abstentionReason:string|null;
 windowConsensus:BootstrapConsensusDiagnostics;
 independentEstimator?:IndependentTempoEstimate;
}
export interface SonicDnaFeatures {
 acousticFeatureProfile:AcousticFeatureProfile;
 sampleRate:number; channels:number; durationSeconds:number; rhythmFeatures:Record<string,unknown>; harmonicFeatures:Record<string,unknown>; vocalFeatures:Record<string,unknown>; bpm:number|null; tempoCandidateBpm:number|null; alternateTempo:number|null; tempoConfidence:number|null;
 key:string|null; mode:"major"|"minor"|null; keyConfidence:number|null; keyTuningCents:number|null; keySegmentAgreement:number|null; keyCandidates:Array<{key:string;mode:"major"|"minor";score:number}>; tuningEvidenceWindows:number; keyAnalysisFftButterflyCount:number; limitations:string[];
 loudnessLufs:number|null; loudnessRangeLu?:number|null; truePeakDbfs?:number|null; rmsLevelDbfs:number; rmsEnergy:number; dynamicRangeDb:number; spectralCentroidHz:number; spectralBandwidthHz:number;
 spectralRolloffHz:number; zeroCrossingRate:number; moodTags:string[]; genreContext:string[]; genreClassification?: GenreFusionResult;
}
const EPSILON=1e-12;
export const MAX_ANALYSIS_SAMPLES=3_000_000;
const NOTES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

export function classifyRelativeMajorMinorAmbiguity(
 primary:Pick<KeyEstimate,"key"|"mode"|"confidence"|"segmentAgreement">,
 independent:Pick<IndependentKeyEstimate,"key"|"mode"|"score"|"margin">,
):boolean {
 if(!primary.key||!primary.mode||!independent.key||!independent.mode||primary.mode===independent.mode)return false;
 const primaryPitch=NOTES.indexOf(primary.key as typeof NOTES[number]);
 const independentPitch=NOTES.indexOf(independent.key as typeof NOTES[number]);
 if(primaryPitch<0||independentPitch<0)return false;
 const distance=(independentPitch-primaryPitch+12)%12;
 const relativePair=distance===3||distance===9;
 const primaryIsStrong=typeof primary.confidence==="number"&&primary.confidence>=MIN_RELIABLE_KEY_CONFIDENCE
  &&typeof primary.segmentAgreement==="number"&&primary.segmentAgreement>=MIN_KEY_SEGMENT_AGREEMENT;
 const independentIsStrong=independent.score>=0.15&&typeof independent.margin==="number"&&independent.margin>=0.025;
 return relativePair&&primaryIsStrong&&independentIsStrong;
}

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

/** Build a detached, bounded mono copy for the Sonic DNA worker while preserving the full-resolution source for vocal analysis. */
export function preparePcmForWorker(
 samples:Float32Array,
 sampleRate:number,
 channels:number,
):{samples:Float32Array;sampleRate:number;channels:1;durationSeconds:number} {
 const prepared=prepareAnalysisPcm(samples,sampleRate,channels);
 return {
  samples:new Float32Array(prepared.samples),
  sampleRate:prepared.sampleRate,
  channels:1,
  durationSeconds:prepared.durationSeconds,
 };
}


function emptyTempoEstimate(reason:string):TempoEstimate {
 return {
  bpm:null,topCandidateBpm:null,alternateTempo:null,confidence:null,method:"high_frequency_transient_autocorrelation",
  candidateBpms:[],candidateScores:[],onsetEnvelope:[],beatTimesSeconds:[],
  downbeatCandidateTimesSeconds:[],beatGridStatus:"not_determined",
  downbeatGridAssumption:null,abstentionReason:reason,windowConsensus:bootstrapCategoricalConsensus([]),
 };
}

function downsampleOnsetEnvelope(values:number[],maxPoints=128):number[] {
 if(!values.length)return [];
 const count=Math.min(maxPoints,values.length),maximum=Math.max(EPSILON,...values);
 const result:number[]=[];
 for(let bucket=0;bucket<count;bucket++){
  const start=Math.floor(bucket*values.length/count),end=Math.max(start+1,Math.floor((bucket+1)*values.length/count));
  let peak=0;
  for(let index=start;index<end;index++)peak=Math.max(peak,values[index]??0);
  result.push(Number((peak/maximum).toFixed(6)));
 }
 return result;
}

function deriveBeatGrid(novelty:number[],bpm:number,framesPerSecond:number):{
 beatTimesSeconds:number[];downbeatCandidateTimesSeconds:number[];
} {
 const periodFrames=60/bpm*framesPerSecond;
 if(!Number.isFinite(periodFrames)||periodFrames<1||!novelty.length)return {beatTimesSeconds:[],downbeatCandidateTimesSeconds:[]};
 let bestPhase=0,bestScore=-1;
 for(let phase=0;phase<Math.ceil(periodFrames);phase++){
  let score=0;
  for(let frame=phase;frame<novelty.length;frame+=periodFrames){
   const index=Math.round(frame);
   score+=Math.max(novelty[index-1]??0,novelty[index]??0,novelty[index+1]??0);
  }
  if(score>bestScore){bestScore=score;bestPhase=phase;}
 }
 const beatTimesSeconds:number[]=[];
 for(let frame=bestPhase;frame<novelty.length&&beatTimesSeconds.length<512;frame+=periodFrames){
  const center=Math.round(frame);
  let selected=center,selectedValue=novelty[center]??0;
  for(let offset=-2;offset<=2;offset++){
   const index=center+offset,value=novelty[index]??-1;
   if(index>=0&&index<novelty.length&&value>selectedValue){selected=index;selectedValue=value;}
  }
  beatTimesSeconds.push(Number((selected/framesPerSecond).toFixed(4)));
 }
 const downbeatCandidateTimesSeconds=beatTimesSeconds.filter((_time,index)=>index%4===0);
 return {beatTimesSeconds,downbeatCandidateTimesSeconds};
}

/**
 * Estimate tempo from high-frequency transient flux rather than raw block
 * loudness. The short-time absolute derivative emphasizes attacks and
 * de-emphasizes sustained tones. Confidence is a signal-prominence diagnostic,
 * not a calibrated probability of BPM accuracy.
 */
function estimateTempoCore(samples:Float32Array,sampleRate:number):TempoEstimate {
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
 const onsetEnvelope=downsampleOnsetEnvelope(novelty);
 if(mean<=EPSILON||Math.sqrt(variance)/Math.max(mean,EPSILON)<0.08||onsetPeakRatio<2.5)
  return {...emptyTempoEstimate("No sufficiently distinct transient activity was detected; sustained or noise-like signals are not assigned a tempo."),onsetEnvelope};
 const scores=new Map<number,number>();
 for(let bpm=40;bpm<=240;bpm++){
  const lag=Math.max(1,Math.round(60/bpm*sampleRate/hop));
  let cross=0,left=0,right=0;
  for(let i=lag;i<novelty.length;i++){
   const x=novelty[i],y=novelty[i-lag];
   cross+=x*y;left+=x*x;right+=y*y;
  }
  scores.set(bpm,cross/Math.sqrt(Math.max(EPSILON,left*right)));
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
 const candidateScores=selected.map(([bpm,score])=>({bpm,score:Number(score.toFixed(6))}));
 if(bestBpm===undefined||bestScore<0.08)
  return {...emptyTempoEstimate("Transient autocorrelation did not produce a sufficiently prominent tempo candidate."),topCandidateBpm:bestBpm??null,candidateBpms:selected.map(([bpm])=>bpm),candidateScores,onsetEnvelope};
 const sortedScores=[...scores.values()].sort((a,b)=>a-b);
 const median=sortedScores[Math.floor(sortedScores.length/2)]??0;
 const confidence=clamp((bestScore-median)/Math.max(EPSILON,1-median));
 if(confidence<MIN_RELIABLE_TEMPO_CONFIDENCE)
  return {...emptyTempoEstimate("Tempo candidate prominence is too weak to support a reliable result."),topCandidateBpm:bestBpm,confidence,candidateBpms:selected.map(([bpm])=>bpm),candidateScores,onsetEnvelope};
 const related=[0.5,1/3,2,3]
  .map(ratio=>({bpm:Math.round(bestBpm*ratio),score:scores.get(Math.round(bestBpm*ratio))??0}))
  .filter(candidate=>candidate.bpm>=40&&candidate.bpm<=240&&candidate.bpm!==bestBpm&&candidate.score>=bestScore*0.25)
  .sort((a,b)=>b.bpm-a.bpm);
 const relatedCandidate=related[0]??null;
 const bpm=relatedCandidate&&relatedCandidate.bpm>bestBpm?relatedCandidate.bpm:bestBpm;
 const alternateTempo=relatedCandidate?(bpm===bestBpm?relatedCandidate.bpm:bestBpm):null;
 const candidates=selected.map(([candidate])=>candidate);
 for(const candidate of [Math.round(bpm),Math.round(bpm)-1,Math.round(bpm)+1,...related.map(item=>item.bpm)])if(candidate>=40&&candidate<=240&&!candidates.includes(candidate))candidates.push(candidate);
 const beatGrid=deriveBeatGrid(novelty,bpm,sampleRate/hop);
 return {
  bpm,topCandidateBpm:bestBpm,alternateTempo:alternateTempo===null?null:(bpm===bestBpm?alternateTempo:bestBpm),
  confidence,method,candidateBpms:candidates.slice(0,8),candidateScores,onsetEnvelope,
  beatTimesSeconds:beatGrid.beatTimesSeconds,
  downbeatCandidateTimesSeconds:beatGrid.downbeatCandidateTimesSeconds,
  beatGridStatus:beatGrid.beatTimesSeconds.length?"tentative":"not_determined",
  downbeatGridAssumption:beatGrid.downbeatCandidateTimesSeconds.length?"four-beat grouping for diagnostics only":null,
  abstentionReason:null,windowConsensus:bootstrapCategoricalConsensus([]),
 };
}


/**
 * Analyse the complete clip, then independently re-run the same tempo detector
 * on up to six non-overlapping 8-second windows. This is window stability
 * evidence, not a multi-model ensemble or a calibrated probability.
 */
export function estimateTempo(samples:Float32Array,sampleRate:number):TempoEstimate {
 const overall=estimateTempoCore(samples,sampleRate);
 if(sampleRate<=0||samples.length<sampleRate*8)return overall;
 const windowSamples=Math.floor(sampleRate*8),windowCount=Math.min(6,Math.floor(samples.length/windowSamples));
 const labels:string[]=[];
 for(let window=0;window<windowCount;window++){
  const start=window*windowSamples;
  const estimate=estimateTempoCore(samples.subarray(start,start+windowSamples),sampleRate);
  if(estimate.bpm!==null)labels.push(String(Math.round(estimate.bpm)));
 }
 const windowConsensus=bootstrapCategoricalConsensus(labels,{iterations:1000,seed:17});
 const independentEstimator=estimateLowFrequencyEnvelopeTempo(samples,sampleRate);
 const tempoRatio=overall.bpm!==null&&independentEstimator.bpm!==null?overall.bpm/independentEstimator.bpm:null;
 const octaveRelated=tempoRatio!==null&&[0.5,1,2].some(ratio=>Math.abs(tempoRatio-ratio)<=Math.max(0.03,ratio*0.03));
 const unstableWindows=windowConsensus.windowCount>=3&&(windowConsensus.winner===null||(windowConsensus.observedAgreement??0)<0.6);
 const materialDisagreement=overall.bpm!==null&&independentEstimator.bpm!==null&&!octaveRelated&&independentEstimator.score>=0.4&&unstableWindows;
 return materialDisagreement
  ? {...overall,bpm:null,confidence:null,abstentionReason:"Independent tempo pathways materially disagreed and the primary tempo windows were unstable; no single tempo is asserted.",windowConsensus,independentEstimator}
  : {...overall,alternateTempo:overall.alternateTempo??(octaveRelated?independentEstimator.bpm:null),windowConsensus,independentEstimator};
}

export function analyzePcm(samples:Float32Array,sampleRate:number,channels=1):SonicDnaFeatures {
 const acousticFeatureProfile=extractAcousticFeatureProfile(samples,sampleRate,channels);
 const prepared=prepareAnalysisPcm(samples,sampleRate,channels),a=prepared.samples,rate=prepared.sampleRate,energy=rms(a);
 const vocalDiagnostics=analyzeVocalSignalDiagnostics(a,rate);
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
 const p10=Math.max(EPSILON,percentile(frames,0.1)),p95=Math.max(p10,percentile(frames,0.95)),tempo=estimateTempo(a,rate),key=estimateKey(a,rate),independentKey:IndependentKeyEstimate=estimateGoertzelKey(a,rate),independentKeyDisagrees=key.key!==null&&independentKey.key!==null&&(key.key!==independentKey.key||key.mode!==independentKey.mode);
 const relativeMajorMinorAmbiguity=classifyRelativeMajorMinorAmbiguity(key,independentKey);
 const resolvedKey:KeyEstimate=relativeMajorMinorAmbiguity?{
  ...key,key:null,mode:null,
  limitation:"Independent audio estimators support relative major/minor tonal centres; pitch-class evidence does not resolve the tonic. No key or mode is asserted.",
 }:key;
 // Signal descriptors are reported in their own numeric fields. Do not
 // relabel RMS, zero-crossing rate, or spectral centroid as emotional mood.
 // A validated, licensed mood model is not currently integrated.
 const moodTags:string[]=[];
 const limitations:string[]=[];
 if(resolvedKey.limitation)limitations.push(resolvedKey.limitation);
 if(tempo.bpm===null)limitations.push("Tempo could not be determined reliably from the supplied audio.");
 limitations.push(...acousticFeatureProfile.abstentionReasons.map((reason)=>"Acoustic feature profile: "+reason));
 return {
  sampleRate,channels:Number.isInteger(channels)&&channels>0?channels:1,durationSeconds:prepared.durationSeconds,
  rhythmFeatures:{status:tempo.bpm===null?"insufficient_evidence":"measured",bpm:tempo.bpm,alternateTempo:tempo.alternateTempo,confidence:tempo.confidence,method:tempo.method,candidateBpms:tempo.candidateBpms,candidateScores:tempo.candidateScores,onsetEnvelope:tempo.onsetEnvelope,beatTimesSeconds:tempo.beatTimesSeconds,downbeatCandidateTimesSeconds:tempo.downbeatCandidateTimesSeconds,beatGridStatus:tempo.beatGridStatus,downbeatGridAssumption:tempo.downbeatGridAssumption,abstentionReason:tempo.abstentionReason,windowConsensus:tempo.windowConsensus,independentEstimator:tempo.independentEstimator??null},
  harmonicFeatures:{status:resolvedKey.key===null?"insufficient_evidence":"measured",key:resolvedKey.key,mode:resolvedKey.mode,confidence:resolvedKey.confidence,method:resolvedKey.method,tuningCents:resolvedKey.tuningCents,segmentAgreement:resolvedKey.segmentAgreement,analysisWindows:resolvedKey.analysisWindows,fftButterflyCount:resolvedKey.fftButterflyCount,segmentChroma:resolvedKey.segmentChroma,topCandidates:resolvedKey.topCandidates,tuningEvidenceWindows:resolvedKey.tuningEvidenceWindows,limitation:resolvedKey.limitation,windowConsensus:resolvedKey.windowConsensus,independentEstimator:independentKey,independentEstimatorDisagrees:independentKeyDisagrees,relativeMajorMinorAmbiguity},
  vocalFeatures:{...vocalDiagnostics},
  bpm:tempo.bpm,tempoCandidateBpm:tempo.topCandidateBpm,alternateTempo:tempo.alternateTempo,tempoConfidence:tempo.confidence,
  key:resolvedKey.key,mode:resolvedKey.mode,keyConfidence:resolvedKey.confidence,keyTuningCents:resolvedKey.tuningCents,keySegmentAgreement:resolvedKey.segmentAgreement,keyCandidates:resolvedKey.topCandidates,tuningEvidenceWindows:resolvedKey.tuningEvidenceWindows,keyAnalysisFftButterflyCount:resolvedKey.fftButterflyCount,limitations,
  loudnessLufs:null,rmsLevelDbfs:20*Math.log10(Math.max(EPSILON,energy)),rmsEnergy:energy,
  dynamicRangeDb:20*Math.log10(p95/p10),spectralCentroidHz:centroid,spectralBandwidthHz:bandwidth,
  spectralRolloffHz:rolloff,zeroCrossingRate:crossings/Math.max(1,a.length-1),
  acousticFeatureProfile,moodTags,genreContext:[]
 };
}
