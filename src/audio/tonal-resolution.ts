export const CIRCLE_OF_FIFTHS = ["C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#", "F"] as const;
export const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export type TonalMode = "major" | "minor";
export type TonalStatus = "CONFIRMED" | "PROVISIONAL" | "UNAVAILABLE";
export type TonalReasonCode =
  | "INSUFFICIENT_TONAL_EVIDENCE"
  | "LOW_WINDOW_CONSENSUS"
  | "LOW_BOOTSTRAP_CONSENSUS"
  | "LOW_RUNNER_UP_MARGIN"
  | "RELATIVE_MAJOR_MINOR_AMBIGUITY"
  | "ADJACENT_FIFTHS_AMBIGUITY";

export interface TonalWindow {
  startSeconds: number;
  endSeconds: number;
  chroma: readonly number[];
  bassChroma?: readonly number[];
  salience: number;
  energy?: number;
  downbeatRoot?: number | null;
  cadenceWeight?: number;
  leadingToneEvidence?: number;
}
export interface TonalCandidateDiagnostic {
  tonic: string;
  pitchClass: number;
  mode: TonalMode;
  score: number;
  bootstrapShare: number;
  windowAgreement: number;
  margin: number;
}
export interface TonalResolution {
  status: TonalStatus;
  tonic: string | null;
  mode: TonalMode | null;
  reasonCodes: TonalReasonCode[];
  candidates: TonalCandidateDiagnostic[];
  bootstrapShare: number | null;
  windowAgreement: number | null;
  runnerUpMargin: number | null;
  validWindowCount: number;
  downbeatAnchorWindowCount: number;
  cadenceWeightedWindowCount: number;
  meanSalience: number;
  method: "circle_of_fifths_audio_first_v1";
  thresholds: {
    minWindows: number;
    minMeanSalience: number;
    minBootstrapShare: number;
    minWindowAgreement: number;
    minRunnerUpMargin: number;
    relativePairAmbiguityMargin: number;
    adjacentFifthsAmbiguityMargin: number;
    bootstrapIterations: number;
  };
}

const NOTE_TO_PITCH: Record<string, number> = {
  C:0, "B#":0, "C#":1, Db:1, D:2, "D#":3, Eb:3, E:4, Fb:4,
  F:5, "E#":5, "F#":6, Gb:6, G:7, "G#":8, Ab:8, A:9, "A#":10, Bb:10, B:11, Cb:11,
};
const FIFTHS_INDEX = new Map<number, number>(CIRCLE_OF_FIFTHS.map((note, index) => [NOTE_TO_PITCH[note]!, index]));
const MIN_WINDOWS = 3;
const MIN_MEAN_SALIENCE = 0.12;
const MIN_BOOTSTRAP_SHARE = 0.8;
const MIN_WINDOW_AGREEMENT = 0.7;
const MIN_RUNNER_UP_MARGIN = 0.025;
const BOOTSTRAP_ITERATIONS = 256;
const EPSILON = 1e-12;

function pitchIndex(value: string | number): number {
  if (typeof value === "number") return Number.isInteger(value) ? ((value % 12) + 12) % 12 : -1;
  return NOTE_TO_PITCH[value.trim().replace(/♯/g, "#").replace(/♭/g, "b")] ?? -1;
}
function noteName(pitch: number): string { return PITCH_CLASSES[((pitch % 12) + 12) % 12]!; }

export function fifthsDistance(a: string | number, b: string | number): number {
  const ai = FIFTHS_INDEX.get(pitchIndex(a));
  const bi = FIFTHS_INDEX.get(pitchIndex(b));
  if (ai === undefined || bi === undefined) return 6;
  const distance = Math.abs(ai - bi);
  return Math.min(distance, 12 - distance);
}

export function relativeMinorOfMajor(major: string): string | null {
  const pitch = pitchIndex(major), position = FIFTHS_INDEX.get(pitch);
  return position === undefined ? null : CIRCLE_OF_FIFTHS[(position + 3) % 12] === undefined
    ? null : noteName(NOTE_TO_PITCH[CIRCLE_OF_FIFTHS[(position + 3) % 12]!]!);
}
export function relativeMajorOfMinor(minor: string): string | null {
  const pitch = pitchIndex(minor), position = FIFTHS_INDEX.get(pitch);
  return position === undefined ? null : noteName(NOTE_TO_PITCH[CIRCLE_OF_FIFTHS[(position + 9) % 12]!]!);
}
export function parallelMajor(root: string): string | null {
  const pitch = pitchIndex(root);
  return pitch < 0 ? null : noteName(pitch);
}
export function parallelMinor(root: string): string | null {
  const pitch = pitchIndex(root);
  return pitch < 0 ? null : noteName(pitch);
}

const SCALE: Record<TonalMode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};
const DEGREE_WEIGHTS: Record<TonalMode, readonly number[]> = {
  major: [2.6, 0.65, 1.15, 1.25, 1.7, 0.65, 0.8],
  minor: [2.6, 0.65, 1.15, 1.25, 1.7, 0.65, 0.8],
};

function normalize(values: readonly number[] | undefined): number[] {
  if (!values || values.length !== 12) return Array(12).fill(0);
  const safe = values.map(value => Number.isFinite(value) ? Math.max(0, value) : 0);
  const sum = safe.reduce((a,b)=>a+b,0);
  return sum > EPSILON ? safe.map(value=>value/sum) : Array(12).fill(0);
}
function clamp(value:number,min=0,max=1):number { return Math.max(min,Math.min(max,value)); }

function scoreKey(window: TonalWindow, tonic: number, mode: TonalMode): number {
  const chroma = normalize(window.chroma);
  const bass = normalize(window.bassChroma);
  const scale = SCALE[mode];
  let score = 0, scaleMass = 0, chromaticMass = 0;
  for (let degree=0;degree<12;degree++) {
    const pitch=(tonic+degree)%12, value=chroma[pitch]!;
    const scaleIndex=scale.indexOf(degree);
    if (scaleIndex>=0) {
      score += value * DEGREE_WEIGHTS[mode][scaleIndex]!;
      scaleMass += value;
    } else if (mode === "minor" && degree === 11) {
      // The raised seventh is a harmonic-minor leading tone: admit it as a
      // weaker cadence cue rather than penalizing it like an unrelated chromatic.
      score += value * 0.6;
      chromaticMass += value * 0.2;
    } else {
      chromaticMass += value;
    }
  }
  score += scaleMass * 0.35 - chromaticMass * 1.35;
  const fifth=(tonic+7)%12, fourth=(tonic+5)%12, mediant=(tonic+(mode==="major"?4:3))%12;
  score += bass[tonic]! * 1.55 + bass[fifth]! * 0.28 + bass[fourth]! * 0.18;
  score += bass[mediant]! * 0.12;
  if (window.downbeatRoot !== undefined && window.downbeatRoot !== null) {
    const anchor=pitchIndex(window.downbeatRoot);
    if (anchor===tonic) score += 0.55;
    else if (anchor===fifth || anchor===fourth) score += 0.08;
  }
  const cadence=clamp(window.cadenceWeight ?? 0);
  score += cadence * (chroma[tonic]! * 0.8 + bass[tonic]! * 0.8);
  score += clamp(window.leadingToneEvidence ?? 0) * chroma[(tonic+11)%12]! * 0.35;
  return score;
}

function rankWindows(windows: readonly TonalWindow[]): Array<{ tonic:number; mode:TonalMode; score:number }> {
  const aggregate=Array(12).fill(0), bassAggregate=Array(12).fill(0);
  let totalWeight=0, cadenceTotal=0, leadingToneTotal=0;
  for(const window of windows) {
    const weight=clamp(window.salience)*Math.max(0.05,window.energy ?? 1);
    cadenceTotal += clamp(window.cadenceWeight ?? 0) * weight;
    leadingToneTotal += clamp(window.leadingToneEvidence ?? 0) * weight;
    const chroma=normalize(window.chroma), bass=normalize(window.bassChroma);
    for(let pitch=0;pitch<12;pitch++) {
      aggregate[pitch]+=chroma[pitch]!*weight;
      bassAggregate[pitch]+=bass[pitch]!*weight;
    }
    totalWeight+=weight;
  }
  if(totalWeight<=EPSILON) return [];
  const combined: TonalWindow={
    startSeconds:0,endSeconds:0,chroma:aggregate,bassChroma:bassAggregate,
    salience:totalWeight/windows.length,energy:1,
    cadenceWeight:cadenceTotal/totalWeight,
    leadingToneEvidence:leadingToneTotal/totalWeight,
  };
  const candidates:Array<{tonic:number;mode:TonalMode;score:number}>=[];
  for(let tonic=0;tonic<12;tonic++) for(const mode of ["major","minor"] as const) {
    const score=scoreKey(combined,tonic,mode);
    // Mild fifth-neighbour smoothing: borrow only 2.5% of each neighbour's score.
    const neighbours=[(tonic+7)%12,(tonic+5)%12];
    const smoothed=score*0.95+neighbours.reduce((sum,root)=>sum+scoreKey(combined,root,mode),0)*0.025;
    candidates.push({tonic,mode,score:smoothed});
  }
  return candidates.sort((a,b)=>b.score-a.score);
}

function seedFor(windows: readonly TonalWindow[]): number {
  let seed=2166136261;
  for(const window of windows) for(const value of [
    ...window.chroma, ...(window.bassChroma ?? []), window.salience, window.energy ?? 1,
    window.startSeconds, window.downbeatRoot ?? -1, window.cadenceWeight ?? 0, window.leadingToneEvidence ?? 0,
  ]) {
    const quantized=Math.round((Number.isFinite(value)?value:0)*1e6);
    seed=Math.imul(seed^quantized,16777619);
  }
  return seed>>>0 || 1;
}
function nextRandom(state:{value:number}):number {
  state.value^=state.value<<13; state.value^=state.value>>>17; state.value^=state.value<<5;
  return (state.value>>>0)/4294967296;
}
function candidateId(candidate:{tonic:number;mode:TonalMode}):string { return candidate.tonic+":"+candidate.mode; }

function unavailable(reason:TonalReasonCode, validWindowCount:number, meanSalience:number):TonalResolution {
  return {
    status:"UNAVAILABLE",tonic:null,mode:null,reasonCodes:[reason],candidates:[],
    bootstrapShare:null,windowAgreement:null,runnerUpMargin:null,validWindowCount,meanSalience,
    method:"circle_of_fifths_audio_first_v1",
    thresholds:{
      minWindows:MIN_WINDOWS,minMeanSalience:MIN_MEAN_SALIENCE,minBootstrapShare:MIN_BOOTSTRAP_SHARE,
      minWindowAgreement:MIN_WINDOW_AGREEMENT,minRunnerUpMargin:MIN_RUNNER_UP_MARGIN,
      relativePairAmbiguityMargin:0.04,adjacentFifthsAmbiguityMargin:0.04,bootstrapIterations:BOOTSTRAP_ITERATIONS,
    },
  };
}

export function resolveTonalCentre(input: readonly TonalWindow[]): TonalResolution {
  const valid=input.filter(window =>
    window && Number.isFinite(window.startSeconds) && Number.isFinite(window.endSeconds)
    && window.endSeconds>window.startSeconds && window.chroma?.length===12
    && window.chroma.some(value=>Number.isFinite(value)&&value>0)
    && Number.isFinite(window.salience) && window.salience>=MIN_MEAN_SALIENCE
  );
  const meanSalience=valid.length?valid.reduce((sum,w)=>sum+clamp(w.salience),0)/valid.length:0;
  if(valid.length===0 || meanSalience<MIN_MEAN_SALIENCE)
    return unavailable("INSUFFICIENT_TONAL_EVIDENCE",valid.length,meanSalience);

  const ranked=rankWindows(valid);
  if(!ranked.length) return unavailable("INSUFFICIENT_TONAL_EVIDENCE",valid.length,meanSalience);
  const best=ranked[0]!,second=ranked[1]!;
  const bestId=candidateId(best);
  const bestWindowVotes=valid.map(window=>{
    const local=rankWindows([window]);
    return local.length && candidateId(local[0]!)===bestId ? 1 : 0;
  });
  const windowAgreement=bestWindowVotes.reduce<number>((a,b)=>a+b,0)/valid.length;
  const state={value:seedFor(valid)};
  const bootstrapWins=new Map<string,number>();
  for(let iteration=0;iteration<BOOTSTRAP_ITERATIONS;iteration++) {
    const sample:TonalWindow[]=[];
    for(let index=0;index<valid.length;index++) sample.push(valid[Math.floor(nextRandom(state)*valid.length)]!);
    const winnerId=candidateId(rankWindows(sample)[0]!);
    bootstrapWins.set(winnerId,(bootstrapWins.get(winnerId)??0)+1);
  }
  const bootstrapShare=(bootstrapWins.get(bestId)??0)/BOOTSTRAP_ITERATIONS;
  const margin=(best.score-second.score)/Math.max(EPSILON,Math.abs(best.score));
  const rankedPair=ranked.find(candidate=>candidate.mode!==best.mode
    && ((candidate.tonic-best.tonic+12)%12===3 || (candidate.tonic-best.tonic+12)%12===9));
  const reasons:TonalReasonCode[]=[];
  if(valid.length<MIN_WINDOWS || windowAgreement<MIN_WINDOW_AGREEMENT) reasons.push("LOW_WINDOW_CONSENSUS");
  if(bootstrapShare<MIN_BOOTSTRAP_SHARE) reasons.push("LOW_BOOTSTRAP_CONSENSUS");
  if(margin<MIN_RUNNER_UP_MARGIN) reasons.push("LOW_RUNNER_UP_MARGIN");
  if(rankedPair && Math.abs(best.score-rankedPair.score)/Math.max(EPSILON,Math.abs(best.score))<0.04)
    reasons.push("RELATIVE_MAJOR_MINOR_AMBIGUITY");
  else if(fifthsDistance(best.tonic,second.tonic)===1
    && Math.abs(best.score-second.score)/Math.max(EPSILON,Math.abs(best.score))<0.04)
    reasons.push("ADJACENT_FIFTHS_AMBIGUITY");

  const candidates=ranked.slice(0,5).map(candidate=>{
    const votes=valid.filter(window=>candidateId(rankWindows([window])[0]!)===candidateId(candidate)).length;
    return {
      tonic:noteName(candidate.tonic),pitchClass:candidate.tonic,mode:candidate.mode,
      score:Number(candidate.score.toFixed(6)),
      bootstrapShare:Number(((bootstrapWins.get(candidateId(candidate))??0)/BOOTSTRAP_ITERATIONS).toFixed(6)),
      windowAgreement:votes/valid.length,
      margin:Number(((best.score-candidate.score)/Math.max(EPSILON,Math.abs(best.score))).toFixed(6)),
    };
  });
  const confirmed=reasons.length===0;
  return {
    status:confirmed?"CONFIRMED":"PROVISIONAL",
    tonic:noteName(best.tonic),mode:best.mode,reasonCodes:reasons,candidates,
    bootstrapShare:Number(bootstrapShare.toFixed(6)),windowAgreement:Number(windowAgreement.toFixed(6)),
    runnerUpMargin:Number(margin.toFixed(6)),validWindowCount:valid.length,
    downbeatAnchorWindowCount:valid.filter(window=>window.downbeatRoot!==undefined&&window.downbeatRoot!==null).length,
    cadenceWeightedWindowCount:valid.filter(window=>(window.cadenceWeight??0)>0).length,
    meanSalience:Number(meanSalience.toFixed(6)),
    method:"circle_of_fifths_audio_first_v1",
    thresholds:{
      minWindows:MIN_WINDOWS,minMeanSalience:MIN_MEAN_SALIENCE,minBootstrapShare:MIN_BOOTSTRAP_SHARE,
      minWindowAgreement:MIN_WINDOW_AGREEMENT,minRunnerUpMargin:MIN_RUNNER_UP_MARGIN,
      relativePairAmbiguityMargin:0.04,adjacentFifthsAmbiguityMargin:0.04,bootstrapIterations:BOOTSTRAP_ITERATIONS,
    },
  };
}
