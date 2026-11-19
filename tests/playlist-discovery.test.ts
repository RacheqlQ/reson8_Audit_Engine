import { describe, expect, it } from "vitest";
import { buildPlaylistSearchTerms, discoverPlaylistCandidates } from "../src/providers/dsp/playlist-discovery.js";

describe("ISRC-led DSP playlist discovery",()=>{
 it("builds bounded, deduplicated search terms from primary and adjacent lanes plus supplied mood tags",()=>{
  expect(buildPlaylistSearchTerms({primaryGenre:"Pop",adjacentLanes:["R&B","Hip-Hop","Pop"],moodTags:["Reflective"]})).toEqual([
   "Pop","R&B","Hip-Hop","Pop Reflective","R&B Reflective",
  ]);
 });
 it("returns Spotify and Apple Music candidates with source links, fit evidence and exact ISRC presence",async()=>{
  const spotifyClient={
   searchPlaylists:async()=>[{
    id:"spotify-playlist-1",name:"Pop Soul Essentials",description:"Reflective Pop and R&B selections",
    owner:{display_name:"Curator One"},external_urls:{spotify:"https://open.spotify.com/playlist/spotify-playlist-1"},
    tracks:{total:42},
   }],
  };
  const fetcher=async(input:RequestInfo|URL)=>{
   const url=String(input);
   if(url.includes("/search?")){
    return new Response(JSON.stringify({results:{playlists:{data:[{
     id:"apple-playlist-1",type:"playlists",attributes:{
      name:"Reflective Pop Soul",curatorName:"Apple Music",playlistType:"editorial",
      url:"https://music.apple.com/ng/playlist/reflective-pop-soul/pl.apple-playlist-1",
      description:{standard:"Reflective Pop and R&B selections"},trackCount:25,
     },
    }]}}}),{status:200,headers:{"content-type":"application/json"}});
   }
   return new Response(JSON.stringify({data:[{
    id:"apple-song-1",type:"songs",attributes:{isrc:"USABC1234567",genreNames:["Pop","R&B"]},
   }]}),{status:200,headers:{"content-type":"application/json"}});
  };
  const result=await discoverPlaylistCandidates({
   isrc:"US-ABC-12-34567",artist:"Artist",title:"Track",primaryGenre:"Pop",
   adjacentLanes:["R&B","Hip-Hop"],moodTags:["Reflective"],storefront:"ng",
  },{spotifyClient,appleMusicToken:"test-token",fetcher,now:()=>new Date("2026-11-19T12:00:00.000Z")});
  expect(result.status).toBe("available");
  expect(result.candidates).toHaveLength(2);
  const apple=result.candidates.find((item)=>item.provider==="apple_music");
  const spotify=result.candidates.find((item)=>item.provider==="spotify");
  expect(apple).toMatchObject({name:"Reflective Pop Soul",curatorName:"Apple Music",containsIsrc:true,retrievedAt:"2026-11-19T12:00:00.000Z"});
  expect(apple?.matchBasis).toContain("The audited recording ISRC is already present in this playlist");
  expect(apple?.matchBasis).toContain("Primary genre match: Pop");
  expect(apple?.matchBasis).toContain("Mood tag match: Reflective");
  expect(spotify).toMatchObject({name:"Pop Soul Essentials",containsIsrc:null,trackCount:42});
  expect(spotify?.url).toBe("https://open.spotify.com/playlist/spotify-playlist-1");
 });
 it("reports missing provider configuration without inventing playlist candidates",async()=>{
  const result=await discoverPlaylistCandidates({isrc:null,primaryGenre:"Pop"},{spotifyClient:null,appleMusicToken:null});
  expect(result.status).toBe("not_configured");
  expect(result.candidates).toEqual([]);
  expect(result.outcomes.every((outcome)=>outcome.status==="not_configured")).toBe(true);
 });
});
