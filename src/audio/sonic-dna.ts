import { estimateKey } from "./key-estimation.js";
import type { GenreFusionResult } from "../genre/fusion.js";
export interface TempoEstimate { bpm: number | null; alternateTempo: number | null; confidence: number | null; }
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


export function estimateTempo(samples:Float32Array,sampleRate:number):TempoEstimate {
 if(sampleRate<=0||samples.length<sampleRate*4||rms(samples)<1e-5)return {bpm:null,alternateTempo:null,confidence:null};
 const hop=Math.max(1,Math.floor(sampleRate/100)),env:number[]=[];
 for(let s=0;s+hop<=samples.length;s+=hop){let sum=0;for(let i=s;i<s+hop;i++)sum+=Math.abs(samples[i]);env.push(sum/hop);}
 const meanEnvelope=env.reduce((sum,value)=>sum+value,0)/Math.max(1,env.length);
 const envelopeVariance=env.reduce((sum,value)=>sum+(value-meanEnvelope)**2,0)/Math.max(1,env.length);
 // A steady sine can create tiny block-boundary fluctuations that correlate
 // at arbitrary lags. Require meaningful amplitude-envelope movement first.
 if(meanEnvelope<=EPSILON||Math.sqrt(envelopeVariance)/meanEnvelope<0.03)return {bpm:null,alternateTempo:null,confidence:null};
 const novelty=env.map((v,i)=>Math.max(0,v-(env[i-1]??v))),scores=new Map<number,number>();
 for(let bpm=60;bpm<=180;bpm++){
  const lag=Math.max(1,Math.round(60/bpm*sampleRate/hop));let c=0,l=0,r=0;
  for(let i=lag;i<novelty.length;i++){c+=novelty[i]*novelty[i-lag];l+=novelty[i]**2;r+=novelty[i-lag]**2;}
  scores.set(bpm,c/Math.sqrt(Math.max(EPSILON,l*r)));
 }
 const sorted=[...scores.entries()].sort((a,b)=>b[1]-a[1]),rawBest=sorted[0]?.[1]??0;
 // A steady/non-rhythmic signal has no onset autocorrelation. Do not turn
 // an all-zero score array into an arbitrary 60 BPM result.
 if(rawBest<0.05)return {bpm:null,alternateTempo:null,confidence:null};
 let measured=sorted[0][0];
 const fast=Math.round(measured*2),slow=Math.round(measured/2);
 let alternate:number|null=fast<=180&&fast>=60?fast:slow>=60?slow:null;
 if(alternate!==null){
  const f=Math.max(measured,alternate),s=Math.min(measured,alternate),fs=scores.get(f)??0,ss=scores.get(s)??0;
  measured=fs>=ss*0.25?f:s;alternate=measured===f?s:f;
 }
 const best=scores.get(measured)??0,runner=sorted.find(([b])=>b!==measured&&b!==alternate)?.[1]??0;
 return {bpm:measured,alternateTempo:alternate,confidence:clamp((best-runner)/Math.max(best,0.01)*2)};
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
  rhythmFeatures:{status:tempo.bpm===null?"insufficient_evidence":"measured",bpm:tempo.bpm,alternateTempo:tempo.alternateTempo,confidence:tempo.confidence,method:"amplitude_envelope_autocorrelation"},
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
