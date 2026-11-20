export type AcousticDescriptor = {
  median:number;
  p10:number;
  p90:number;
  unit:string;
  method:string;
};

export interface AcousticFeatureProfile {
  schemaVersion:"1.0.0";
  status:"measured"|"insufficient_evidence";
  provenance:{
    featureVersion:"acoustic-profile-v1";
    sourceAudioSha256?:string;
    measuredAt?:string;
    algorithm:"reson8-windowed-radix2-fft";
    sourceSampleRateHz:number;
    analysisSampleRateHz:number;
    channels:number;
    downmix:"arithmetic_mean";
    durationSeconds:number;
    sourceStartSeconds:number;
    sourceEndSeconds:number;
    windowSizeSamples:number;
    hopSizeSamples:number;
    windowCount:number;
    aggregation:"median_and_percentiles";
    maxWindowsApplied:boolean;
  };
  descriptors:{
    rmsDbfs:AcousticDescriptor;
    peakDbfs:AcousticDescriptor;
    crestFactorDb:AcousticDescriptor;
    spectralCentroidHz:AcousticDescriptor;
    spectralBandwidthHz:AcousticDescriptor;
    spectralRolloff85Hz:AcousticDescriptor;
    spectralFlatness:AcousticDescriptor;
    spectralFlux:AcousticDescriptor;
    zeroCrossingRate:AcousticDescriptor;
    lowBandEnergyRatio:AcousticDescriptor;
    midBandEnergyRatio:AcousticDescriptor;
    highBandEnergyRatio:AcousticDescriptor;
  };
  windowSummaries:Array<{startSeconds:number;endSeconds:number;rmsDbfs:number;spectralCentroidHz:number;spectralFlatness:number}>;
  predictions:{
    mood:{status:"unavailable";label:null;probability:null;reasonCode:"VALIDATED_MODEL_NOT_CONFIGURED"};
    energy:{status:"unavailable";label:null;probability:null;reasonCode:"CALIBRATED_ENERGY_MODEL_NOT_CONFIGURED"};
  };
  abstentionReasons:string[];
}

const WINDOW_SIZE=2048;
const HOP_SIZE=1024;
const MAX_WINDOWS=128;
const EPSILON=1e-12;
const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));

function percentile(values:number[],p:number):number {
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b);
  const index=(sorted.length-1)*p,lower=Math.floor(index),upper=Math.ceil(index);
  return lower===upper?sorted[lower]!:sorted[lower]!+(sorted[upper]!-sorted[lower]!)*(index-lower);
}

function summarize(values:number[],unit:string,method:string):AcousticDescriptor {
  return {median:percentile(values,0.5),p10:percentile(values,0.1),p90:percentile(values,0.9),unit,method};
}

function fft(real:Float64Array,imag:Float64Array):void {
  const n=real.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;
    for(;j&bit;bit>>=1)j^=bit;
    j^=bit;
    if(i<j){const r=real[i]!;real[i]=real[j]!;real[j]=r;const im=imag[i]!;imag[i]=imag[j]!;imag[j]=im;}
  }
  for(let length=2;length<=n;length<<=1){
    const angle=-2*Math.PI/length,stepReal=Math.cos(angle),stepImag=Math.sin(angle);
    for(let start=0;start<n;start+=length){
      let wr=1,wi=0;
      for(let offset=0;offset<length/2;offset++){
        const even=start+offset,odd=even+length/2;
        const oddReal=real[odd]!*wr-imag[odd]!*wi,oddImag=real[odd]!*wi+imag[odd]!*wr;
        const evenReal=real[even]!,evenImag=imag[even]!;
        real[even]=evenReal+oddReal;imag[even]=evenImag+oddImag;
        real[odd]=evenReal-oddReal;imag[odd]=evenImag-oddImag;
        const nextWr=wr*stepReal-wi*stepImag;
        wi=wr*stepImag+wi*stepReal;wr=nextWr;
      }
    }
  }
}

type WindowResult={rmsDbfs:number;peakDbfs:number;crestFactorDb:number;centroid:number;bandwidth:number;rolloff:number;flatness:number;flux:number;zcr:number;low:number;mid:number;high:number;magnitudes:number[]};

function measureWindow(samples:Float32Array,start:number,sampleRate:number,channels:number,previous:number[]|null):WindowResult {
  const real=new Float64Array(WINDOW_SIZE),imag=new Float64Array(WINDOW_SIZE);
  let sumSquares=0,peak=0,crossings=0,previousSample=0;
  for(let i=0;i<WINDOW_SIZE;i++){
    let channelSum=0;\n    for(let channel=0;channel<channels;channel++){const raw=samples[(start+i)*channels+channel]??0;channelSum+=Number.isFinite(raw)?raw:0;}\n    const value=channelSum/channels;
    sumSquares+=value*value;peak=Math.max(peak,Math.abs(value));
    if(i>0&&((previousSample<0&&value>=0)||(previousSample>=0&&value<0)))crossings++;
    previousSample=value;
    const hann=0.5-0.5*Math.cos(2*Math.PI*i/(WINDOW_SIZE-1));
    real[i]=value*hann;
  }
  fft(real,imag);
  const magnitudes:number[]=[];let total=0,weighted=0,logSum=0,arithmetic=0,low=0,mid=0,high=0;
  const nyquist=sampleRate/2;
  for(let bin=1;bin<=WINDOW_SIZE/2;bin++){
    const magnitude=Math.hypot(real[bin]!,imag[bin]!);
    const hz=bin*sampleRate/WINDOW_SIZE;
    magnitudes.push(magnitude);total+=magnitude;weighted+=hz*magnitude;
    logSum+=Math.log(Math.max(EPSILON,magnitude));arithmetic+=magnitude;
    const power=magnitude*magnitude;
    if(hz>=20&&hz<250)low+=power;
    else if(hz>=250&&hz<4000)mid+=power;
    else if(hz>=4000&&hz<=nyquist)high+=power;
  }
  const centroid=total>EPSILON?weighted/total:0;
  let variance=0,cumulative=0,rolloff=0;
  for(let bin=1;bin<=magnitudes.length;bin++){
    const magnitude=magnitudes[bin-1]!,hz=bin*sampleRate/WINDOW_SIZE;
    variance+=(hz-centroid)**2*magnitude;cumulative+=magnitude;
    if(!rolloff&&cumulative>=total*0.85)rolloff=hz;
  }
  const rms=Math.sqrt(sumSquares/WINDOW_SIZE),peakDbfs=20*Math.log10(Math.max(EPSILON,peak));
  const rmsDbfs=20*Math.log10(Math.max(EPSILON,rms));
  const bandTotal=low+mid+high;
  let flux=0;
  if(previous&&previous.length===magnitudes.length){
    let difference=0,reference=0;
    for(let i=0;i<magnitudes.length;i++){difference+=Math.max(0,magnitudes[i]!-previous[i]!);reference+=magnitudes[i]!;}
    flux=reference>EPSILON?difference/reference:0;
  }
  return {
    rmsDbfs,peakDbfs,crestFactorDb:peakDbfs-rmsDbfs,
    centroid,bandwidth:total>EPSILON?Math.sqrt(variance/total):0,rolloff,
    flatness:arithmetic>EPSILON?Math.exp(logSum/magnitudes.length)/(arithmetic/magnitudes.length):0,
    flux,zcr:crossings/(WINDOW_SIZE-1),
    low:bandTotal>EPSILON?low/bandTotal:0,mid:bandTotal>EPSILON?mid/bandTotal:0,high:bandTotal>EPSILON?high/bandTotal:0,
    magnitudes,
  };
}

function emptyProfile(sampleRate:number,channels:number,duration:number,reason:string):AcousticFeatureProfile {
  const unavailable=(unit:string,method:string):AcousticDescriptor=>({median:0,p10:0,p90:0,unit,method});
  return {
    schemaVersion:"1.0.0",status:"insufficient_evidence",
    provenance:{featureVersion:"acoustic-profile-v1",algorithm:"reson8-windowed-radix2-fft",sourceSampleRateHz:sampleRate,analysisSampleRateHz:sampleRate,channels,downmix:"arithmetic_mean",durationSeconds:duration,sourceStartSeconds:0,sourceEndSeconds:duration,windowSizeSamples:WINDOW_SIZE,hopSizeSamples:HOP_SIZE,windowCount:0,aggregation:"median_and_percentiles",maxWindowsApplied:false},
    descriptors:{
      rmsDbfs:unavailable("dBFS","windowed_pcm_rms"),peakDbfs:unavailable("dBFS","windowed_pcm_peak"),crestFactorDb:unavailable("dB","peak_to_rms"),
      spectralCentroidHz:unavailable("Hz","hann_window_radix2_fft"),spectralBandwidthHz:unavailable("Hz","hann_window_radix2_fft"),
      spectralRolloff85Hz:unavailable("Hz","hann_window_radix2_fft"),spectralFlatness:unavailable("ratio","geometric_to_arithmetic_spectral_mean"),
      spectralFlux:unavailable("ratio","positive_spectral_flux"),zeroCrossingRate:unavailable("ratio","pcm_zero_crossing_rate"),
      lowBandEnergyRatio:unavailable("ratio","fft_band_power_ratio_20_250_hz"),midBandEnergyRatio:unavailable("ratio","fft_band_power_ratio_250_4000_hz"),highBandEnergyRatio:unavailable("ratio","fft_band_power_ratio_4000_hz_to_nyquist"),
    },
    windowSummaries:[],
    predictions:{mood:{status:"unavailable",label:null,probability:null,reasonCode:"VALIDATED_MODEL_NOT_CONFIGURED"},energy:{status:"unavailable",label:null,probability:null,reasonCode:"CALIBRATED_ENERGY_MODEL_NOT_CONFIGURED"}},
    abstentionReasons:[reason],
  };
}

/** Multi-window PCM descriptors. These are acoustic measurements, not mood labels or calibrated perceptual predictions. */
export function extractAcousticFeatureProfile(samples:Float32Array,sampleRate:number,channels=1):AcousticFeatureProfile {
  const validChannels=Number.isInteger(channels)&&channels>0&&channels<=8?channels:1;
  if(!Number.isFinite(sampleRate)||sampleRate<=0||!samples.length||samples.length%validChannels!==0){
    return emptyProfile(Number.isFinite(sampleRate)&&sampleRate>0?sampleRate:0,validChannels,0,"INVALID_AUDIO_FORMAT");
  }
  const frames=samples.length/validChannels,duration=frames/sampleRate;
  if(frames<WINDOW_SIZE)return emptyProfile(sampleRate,validChannels,duration,"INSUFFICIENT_ANALYSIS_WINDOWS");
  const mono=new Float32Array(frames);
  let signalEnergy=0;
  for(let frame=0;frame<frames;frame++){
    let sum=0;
    for(let channel=0;channel<validChannels;channel++){
      const value=samples[frame*validChannels+channel]!;
      sum+=Number.isFinite(value)?value:0;
    }
    const value=sum/validChannels;mono[frame]=value;signalEnergy+=value*value;
  }
  if(Math.sqrt(signalEnergy/frames)<1e-6)return emptyProfile(sampleRate,validChannels,duration,"NO_MEASURABLE_SIGNAL");
  const possible=Math.floor((frames-WINDOW_SIZE)/HOP_SIZE)+1;
  const count=Math.min(MAX_WINDOWS,possible),stride=possible>MAX_WINDOWS?Math.ceil((possible-1)/(MAX_WINDOWS-1)):1;
  const rows:WindowResult[]=[],windowSummaries:AcousticFeatureProfile["windowSummaries"]=[];
  let previous:number[]|null=null;
  for(let index=0;index<count;index++){
    const start=Math.min(index*stride*HOP_SIZE,frames-WINDOW_SIZE);
    const row=measureWindow(samples,start,sampleRate,validChannels,previous);
    rows.push(row);previous=row.magnitudes;
    windowSummaries.push({startSeconds:start/sampleRate,endSeconds:(start+WINDOW_SIZE)/sampleRate,rmsDbfs:row.rmsDbfs,spectralCentroidHz:row.centroid,spectralFlatness:row.flatness});
  }
  const values=(key:keyof Omit<WindowResult,"magnitudes">)=>rows.map(row=>row[key] as number);
  const methods={
    rmsDbfs:["dBFS","windowed_pcm_rms"],peakDbfs:["dBFS","windowed_pcm_peak"],crestFactorDb:["dB","peak_to_rms"],
    spectralCentroidHz:["Hz","hann_window_radix2_fft"],spectralBandwidthHz:["Hz","hann_window_radix2_fft"],
    spectralRolloff85Hz:["Hz","hann_window_radix2_fft"],spectralFlatness:["ratio","geometric_to_arithmetic_spectral_mean"],
    spectralFlux:["ratio","positive_spectral_flux"],zeroCrossingRate:["ratio","pcm_zero_crossing_rate"],
    lowBandEnergyRatio:["ratio","fft_band_power_ratio_20_250_hz"],midBandEnergyRatio:["ratio","fft_band_power_ratio_250_4000_hz"],highBandEnergyRatio:["ratio","fft_band_power_ratio_4000_hz_to_nyquist"],
  } as const;
  const descriptor=(key:keyof typeof methods,field:keyof Omit<WindowResult,"magnitudes">)=>summarize(values(field),methods[key][0],methods[key][1]);
  return {
    schemaVersion:"1.0.0",status:"measured",
    provenance:{featureVersion:"acoustic-profile-v1",algorithm:"reson8-windowed-radix2-fft",sourceSampleRateHz:sampleRate,analysisSampleRateHz:sampleRate,channels:validChannels,downmix:"arithmetic_mean",durationSeconds:duration,sourceStartSeconds:0,sourceEndSeconds:duration,windowSizeSamples:WINDOW_SIZE,hopSizeSamples:HOP_SIZE,windowCount:rows.length,aggregation:"median_and_percentiles",maxWindowsApplied:possible>MAX_WINDOWS},
    descriptors:{
      rmsDbfs:descriptor("rmsDbfs","rmsDbfs"),peakDbfs:descriptor("peakDbfs","peakDbfs"),crestFactorDb:descriptor("crestFactorDb","crestFactorDb"),
      spectralCentroidHz:descriptor("spectralCentroidHz","centroid"),spectralBandwidthHz:descriptor("spectralBandwidthHz","bandwidth"),
      spectralRolloff85Hz:descriptor("spectralRolloff85Hz","rolloff"),spectralFlatness:descriptor("spectralFlatness","flatness"),
      spectralFlux:descriptor("spectralFlux","flux"),zeroCrossingRate:descriptor("zeroCrossingRate","zcr"),
      lowBandEnergyRatio:descriptor("lowBandEnergyRatio","low"),midBandEnergyRatio:descriptor("midBandEnergyRatio","mid"),highBandEnergyRatio:descriptor("highBandEnergyRatio","high"),
    },
    windowSummaries,
    predictions:{mood:{status:"unavailable",label:null,probability:null,reasonCode:"VALIDATED_MODEL_NOT_CONFIGURED"},energy:{status:"unavailable",label:null,probability:null,reasonCode:"CALIBRATED_ENERGY_MODEL_NOT_CONFIGURED"}},
    abstentionReasons:[],
  };
}
