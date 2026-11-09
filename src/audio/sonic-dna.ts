export interface TempoEstimate { bpm: number | null; alternateTempo: number | null; confidence: number | null; }
export interface SonicDnaFeatures {
 sampleRate:number; channels:number; durationSeconds:number; bpm:number|null; alternateTempo:number|null; tempoConfidence:number|null;
 key:string|null; mode:"major"|"minor"|null; keyConfidence:number|null; limitations:string[];
 loudnessLufs:number; rmsEnergy:number; dynamicRangeDb:number; spectralCentroidHz:number; spectralBandwidthHz:number;
 spectralRolloffHz:number; zeroCrossingRate:number; moodTags:string[]; genreContext:string[];
}
const EPSILON=1e-12, MAX_ANALYSIS_SAMPLES=3_000_000, NOTES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const MAJOR=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const MINOR=[6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
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

function estimateKey(samples:Float32Array,sampleRate:number):{key:string|null;mode:"major"|"minor"|null;confidence:number|null;limitation:string|null} {
 if(samples.length<sampleRate*2||rms(samples)<1e-5)return {key:null,mode:null,confidence:null,limitation:"Insufficient pitched audio or signal energy for reliable key estimation."};
 const size=2048, windows=Math.min(12,Math.max(1,Math.floor(samples.length/size))), chroma=Array(12).fill(0);
 // The DFT below reads every fourth sample. Its effective Nyquist limit is
 // therefore sampleRate/8, not sampleRate/2. Never score aliased bins.
 const maxHz=Math.min(2000,sampleRate/8),maxBin=Math.min(Math.floor(size/8),Math.floor(maxHz*size/sampleRate));
 let used=0;
 for(let w=0;w<windows;w++){
  const start=windows===1?0:Math.floor(w*(samples.length-size)/(windows-1));
  if(start<0||start+size>samples.length)continue;
  for(let bin=1;bin<=maxBin;bin++){
   const hz=bin*sampleRate/size;
   if(hz<65)continue;
   let re=0,im=0;
   for(let n=0;n<size;n+=4){
    const win=0.5-0.5*Math.cos(2*Math.PI*n/(size-1)),angle=2*Math.PI*bin*n/size,x=samples[start+n]*win;
    re+=x*Math.cos(angle);im-=x*Math.sin(angle);
   }
   const mag=Math.hypot(re,im);
   if(mag>EPSILON){const midi=Math.round(69+12*Math.log2(hz/440));chroma[(midi%12+12)%12]+=mag/Math.sqrt(Math.max(1,hz/65));}
  }
  used++;
 }
 const total=chroma.reduce((a,b)=>a+b,0);
 if(!used||total<=EPSILON)return {key:null,mode:null,confidence:null,limitation:"No stable tonal energy was detected for key estimation."};
 const norm=chroma.map(x=>x/total),candidates:Array<{key:number;mode:"major"|"minor";score:number}>=[];
 for(let k=0;k<12;k++)for(const [mode,profile] of [["major",MAJOR],["minor",MINOR]] as const){
  let score=0,den=0;
  for(let i=0;i<12;i++){score+=norm[(i+k)%12]*profile[i];den+=profile[i]*profile[i];}
  candidates.push({key:k,mode,score:score/Math.sqrt(den)});
 }
 candidates.sort((a,b)=>b.score-a.score);
 const best=candidates[0],second=candidates[1],confidence=clamp((best.score-second.score)/Math.max(best.score,EPSILON)*5);
 if(confidence<0.08)return {key:null,mode:null,confidence,limitation:"Key and mode confidence was below threshold; no key is asserted."};
 return {key:NOTES[best.key],mode:best.mode,confidence,limitation:null};
}

export function estimateTempo(samples:Float32Array,sampleRate:number):TempoEstimate {
 if(sampleRate<=0||samples.length<sampleRate*4||rms(samples)<1e-5)return {bpm:null,alternateTempo:null,confidence:null};
 const hop=Math.max(1,Math.floor(sampleRate/100)),env:number[]=[];
 for(let s=0;s+hop<=samples.length;s+=hop){let sum=0;for(let i=s;i<s+hop;i++)sum+=Math.abs(samples[i]);env.push(sum/hop);}
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
  bpm:tempo.bpm,alternateTempo:tempo.alternateTempo,tempoConfidence:tempo.confidence,
  key:key.key,mode:key.mode,keyConfidence:key.confidence,limitations,
  loudnessLufs:20*Math.log10(Math.max(EPSILON,energy))-0.691,rmsEnergy:energy,
  dynamicRangeDb:20*Math.log10(p95/p10),spectralCentroidHz:centroid,spectralBandwidthHz:bandwidth,
  spectralRolloffHz:rolloff,zeroCrossingRate:crossings/Math.max(1,a.length-1),
  moodTags:tags,genreContext:classifyGenreFromBpm(tempo.bpm)
 };
}
export function classifyGenreFromBpm(bpm:number|null):string[] {
 if(bpm===null)return [];
 const m:string[]=[];
 if(bpm>=60&&bpm<=90)m.push("Ambient","R&B","Reggae");
 if(bpm>=70&&bpm<=100)m.push("Hip-Hop/Lo-Fi","Reggaeton");
 if(bpm>=90&&bpm<=140)m.push("Country/Folk");
 if(bpm>=100&&bpm<=130)m.push("Pop");
 if(bpm>=108&&bpm<=118)m.push("Amapiano");
 if(bpm>=100&&bpm<=120)m.push("Afrobeats");
 return [...new Set(m)];
}
