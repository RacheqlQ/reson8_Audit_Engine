export function detectTrackPlatform(value){
  const u=new URL(value),host=u.hostname.toLowerCase(),parts=u.pathname.split("/").filter(Boolean);
  if(u.protocol!=="https:"||u.username||u.password||u.port)throw new Error("Use a credential-free HTTPS track URL");
  if(["open.spotify.com","play.spotify.com"].includes(host)&&parts.includes("track")&&parts[parts.indexOf("track")+1])return "Spotify";
  if(["music.apple.com","itunes.apple.com","geo.music.apple.com"].includes(host)){
    const songIndex=parts.indexOf("song"),albumIndex=parts.indexOf("album");
    const isSongPath=songIndex>=0&&(albumIndex<0||songIndex<albumIndex);
    const firstSongPart=isSongPath?parts[songIndex+1]:null;
    const songId=isSongPath?(/^\d+$/.test(firstSongPart||"")?firstSongPart:parts[songIndex+2]):null;
    const albumId=albumIndex>=0?parts[albumIndex+2]:null;
    const trackQuery=u.searchParams.get("i");
    if(songId&&/^\d+$/.test(songId)){
      if(trackQuery&&(!/^\d+$/.test(trackQuery)||trackQuery!==songId))throw new Error("Apple Music song URL contains conflicting track identifiers");
      return "Apple Music";
    }
    if(albumId&&/^\d+$/.test(albumId)&&trackQuery&&/^\d+$/.test(trackQuery))return "Apple Music";
    if(albumId&&/^\d+$/.test(albumId))throw new Error("Apple Music album links identify a collection. Submit a track-specific song URL or an album URL with ?i={trackId}.");
  }
  if(["deezer.com","www.deezer.com"].includes(host)&&parts[0]==="track"&&parts[1])return "Deezer";
  if(["tidal.com","listen.tidal.com"].includes(host)&&parts.includes("track")&&parts[parts.indexOf("track")+1])return "TIDAL";
  if(host==="music.youtube.com"&&u.pathname==="/watch"&&u.searchParams.get("v"))return "YouTube Music";
  if(["audiomack.com","www.audiomack.com"].includes(host)&&parts.length>=2)return "Audiomack";
  throw new Error("Unsupported DSP or non-track URL");
}
