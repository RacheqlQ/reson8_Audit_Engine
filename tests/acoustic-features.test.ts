import { describe, expect, it } from "vitest";
import { extractAcousticFeatureProfile } from "../src/audio/acoustic-features.js";

function tone(frequency:number, seconds=4, sampleRate=16000, amplitude=0.25):Float32Array {
  return Float32Array.from({length:Math.floor(seconds*sampleRate)},(_,i)=>
    amplitude*Math.sin(2*Math.PI*frequency*i/sampleRate));
}

function stereo(left:Float32Array,right:Float32Array):Float32Array {
  const output=new Float32Array(left.length*2);
  for(let i=0;i<left.length;i++){output[i*2]=left[i];output[i*2+1]=right[i];}
  return output;
}

describe("multi-window acoustic feature profile",()=>{
  it("returns independently named signal descriptors with units and method provenance",()=>{
    const sampleRate=16000;
    const profile=extractAcousticFeatureProfile(tone(440,6,sampleRate),sampleRate);
    expect(profile.status).toBe("measured");
    expect(profile.descriptors.rmsDbfs).toMatchObject({unit:"dBFS",method:"windowed_pcm_rms"});
    expect(profile.descriptors.peakDbfs).toMatchObject({unit:"dBFS",method:"windowed_pcm_peak"});
    expect(profile.descriptors.crestFactorDb).toMatchObject({unit:"dB",method:"peak_to_rms"});
    expect(profile.descriptors.spectralCentroidHz).toMatchObject({unit:"Hz"});
    expect(profile.descriptors.spectralFlatness).toMatchObject({unit:"ratio"});
    expect(profile.descriptors.zeroCrossingRate).toMatchObject({unit:"ratio"});
    expect(profile.descriptors.lowBandEnergyRatio).toMatchObject({unit:"ratio"});
    expect(profile.descriptors.midBandEnergyRatio).toMatchObject({unit:"ratio"});
    expect(profile.descriptors.highBandEnergyRatio).toMatchObject({unit:"ratio"});
  });

  it("records reproducible source and analysis provenance, including window coverage",()=>{
    const sampleRate=16000,seconds=7;
    const profile=extractAcousticFeatureProfile(tone(880,seconds,sampleRate),sampleRate);
    expect(profile.provenance).toMatchObject({
      sourceSampleRateHz:sampleRate,
      analysisSampleRateHz:sampleRate,
      analysisResampling:"none",
      channels:1,
      durationSeconds:seconds,
      sourceStartSeconds:0,
      sourceEndSeconds:seconds,
      windowSizeSamples:2048,
      hopSizeSamples:1024,
      aggregation:"median_and_percentiles",
      featureVersion:"acoustic-profile-v1",
    });
    expect(profile.provenance.windowCount).toBeGreaterThan(1);
    expect(profile.provenance.windowCount).toBe(profile.windowSummaries.length);
  });

  it("keeps stereo source channels and measures the downmixed analysis signal",()=>{
    const sampleRate=16000;
    const left=tone(220,5,sampleRate,0.2),right=tone(440,5,sampleRate,0.1);
    const profile=extractAcousticFeatureProfile(stereo(left,right),sampleRate,2);
    expect(profile.provenance.channels).toBe(2);
    expect(profile.provenance.sourceSampleRateHz).toBe(sampleRate);
    expect(profile.status).toBe("measured");
  });

  it("abstains for silence and clips too short to contain a complete analysis window",()=>{
    const silence=extractAcousticFeatureProfile(new Float32Array(16000*4),16000);
    expect(silence.status).toBe("insufficient_evidence");
    expect(silence.abstentionReasons).toContain("NO_MEASURABLE_SIGNAL");
    const short=extractAcousticFeatureProfile(new Float32Array(1024),16000);
    expect(short.status).toBe("insufficient_evidence");
    expect(short.abstentionReasons).toContain("INSUFFICIENT_ANALYSIS_WINDOWS");
  });

  it("caps window count while retaining coverage through the end of a long recording",()=>{
    const sampleRate=16000,seconds=180;
    const profile=extractAcousticFeatureProfile(tone(440,seconds,sampleRate),sampleRate);
    expect(profile.provenance.windowCount).toBe(128);
    expect(profile.provenance.maxWindowsApplied).toBe(true);
    expect(profile.windowSummaries[0]?.startSeconds).toBe(0);
    expect(profile.windowSummaries.at(-1)?.endSeconds).toBeGreaterThan(179);
  });

  it("keeps the three frequency-band power ratios bounded and normalized",()=>{
    const profile=extractAcousticFeatureProfile(tone(440,5,16000),16000);
    const total=profile.descriptors.lowBandEnergyRatio.median
      +profile.descriptors.midBandEnergyRatio.median
      +profile.descriptors.highBandEnergyRatio.median;
    expect(total).toBeCloseTo(1,5);
    expect(profile.descriptors.lowBandEnergyRatio.median).toBeGreaterThanOrEqual(0);
    expect(profile.descriptors.highBandEnergyRatio.median).toBeLessThanOrEqual(1);
  });

  it("does not turn signal descriptors into mood or calibrated energy labels",()=>{
    const profile=extractAcousticFeatureProfile(tone(3000,5,16000),16000);
    expect(profile.predictions.mood).toMatchObject({
      status:"unavailable",
      label:null,
      probability:null,
      reasonCode:"VALIDATED_MODEL_NOT_CONFIGURED",
    });
    expect(profile.predictions.energy).toMatchObject({
      status:"unavailable",
      label:null,
      probability:null,
      reasonCode:"CALIBRATED_ENERGY_MODEL_NOT_CONFIGURED",
    });
  });

  it("reports percentile summaries from multiple windows rather than a single clip-wide average",()=>{
    const sampleRate=16000,first=tone(440,3,sampleRate,0.08),second=tone(440,3,sampleRate,0.5);
    const combined=new Float32Array(first.length+second.length);
    combined.set(first);combined.set(second,first.length);
    const profile=extractAcousticFeatureProfile(combined,sampleRate);
    expect(profile.provenance.windowCount).toBeGreaterThanOrEqual(4);
    expect(profile.descriptors.rmsDbfs.p10).toBeLessThan(profile.descriptors.rmsDbfs.p90);
    expect(profile.descriptors.rmsDbfs.median).toBeGreaterThan(profile.descriptors.rmsDbfs.p10);
  });
});
