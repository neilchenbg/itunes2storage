import * as plist from 'plist';
import * as m3u from 'm3u';
import {decode} from 'urlencode';
import {isArray} from 'underscore';
import {traceNotice, traceError} from './service/log';
import {
  readFile,
  writeFile,
  copyFile,
  readFileAsJSON,
  writeFileAsJSON,
  mkDir,
  checkDir
} from './node/file';

let _settings = {},
    _package = {},
    _tracks = {},
    _m3uTracks = {},
    _appRootPath = '';

Promise
  .all([
    readFileAsJSON('settings.json'),
    readFileAsJSON('package.json')
  ])
  .then((result) =>  {
    [_settings, _package] = result;
    return checkDir(_settings.targetPath);
  })
  .then((result) => {
    _appRootPath = `${_settings.targetPath}_${_package.name}/`;
    return mkDir(_appRootPath);
  })
  .then((result) => {
    return readFile(_settings.itunesXMLPath);
  })
  .then((result) => {
    let itunesLibrary = {};

    try {
      itunesLibrary = plist.parse(result);
    } catch(e) {
      throw new Error(e.toString());
    }

    traceNotice(`已讀取itunes資料庫檔案 資料庫版本: ${itunesLibrary['Application Version']}`, 'app');

    let playLists = [],
        trackIds = [];

    if (itunesLibrary['Playlists'] && isArray(itunesLibrary['Playlists']) && itunesLibrary['Playlists'].length > 0) {
      for (let playList of itunesLibrary['Playlists']) {
        if (
          playList['Name'] &&
          playList['Name'].indexOf(_settings.playlistPrefix + '_') != -1 &&
          playList['Playlist Items'] &&
          isArray(playList['Playlist Items'])
        ) {
          let tmpTrackIds = [];

          for (let playListItem of playList['Playlist Items']) {
            if(itunesLibrary['Tracks'][playListItem['Track ID']]) {
              trackIds[trackIds.length] = playListItem['Track ID'];
              tmpTrackIds[tmpTrackIds.length] = itunesLibrary['Tracks'][playListItem['Track ID']]['Persistent ID'];
            }
          }

          playLists[playLists.length] = {
            id: playList['Playlist ID'],
            pid: playList['Playlist Persistent ID'],
            name: playList['Name'].replace(_settings.playlistPrefix + '_', ''),
            tracks: tmpTrackIds
          };
        }
      }
    }

    trackIds = [...new Set(trackIds)];

    let promiseArray = [];

    for (let trackId of trackIds) {
      if (!itunesLibrary['Tracks'][trackId]) {
        continue;
      }

      let trackItem = itunesLibrary['Tracks'][trackId],
          trackSrc = decode(trackItem['Location'].replace('file://', '')),
          [trackPID, trackName, trackArtist, trackAlbum, trackDiskNumber, trackNumber, trakcExt, trackModified, trackTotalTime] = [
            trackItem['Persistent ID'],
            trackItem['Name'],
            trackItem['Artist'],
            trackItem['Album'],
            trackItem['Disc Number'] ? trackItem['Disc Number'] : 1,
            trackItem['Track Number'] ? trackItem['Track Number'] : 1,
            trackSrc.split('.').pop(),
            trackItem['Date Modified'],
            Math.ceil(trackItem['Total Time'] / 1000)
          ];
      // let trackNewName = `${trackArtist} - ${trackAlbum} ${trackDiskNumber}-${trackNumber} ${trackName}.${trakcExt}`,
      let trackNewName = `${trackPID}.${trakcExt}`,
          trackNewPath = `${_settings.targetPath}${trackNewName}`,
          trackNewM3uPath = `../${trackNewName}`;

      _tracks[trackPID] = {
        pid: trackPID,
        path: trackNewPath,
        modified: trackModified
      };
      _m3uTracks[trackPID] = {
        pid: trackPID,
        title: `${trackAlbum} - ${trackArtist}`,
        path: trackNewM3uPath,
        time: trackTotalTime
      };

      promiseArray[promiseArray.length] = copyFile(trackSrc, trackNewPath);
    }

    promiseArray[promiseArray.length] = writeFileAsJSON(`${_appRootPath}tracks.json`, _tracks);
    promiseArray[promiseArray.length] = writeFileAsJSON(`${_appRootPath}playlists.json`, _m3uTracks);

    for (let playList of playLists) {
      let m3uWriter = m3u.extendedWriter();

      m3uWriter.comment(`Play list create by ${_package.name}, author: ${_package.author}`);
      m3uWriter.write();

      for (let trackPID of playList.tracks) {
        if (_m3uTracks[trackPID]) {
          let [m3uPath, m3uTime, m3uTitle] = [
            _m3uTracks[trackPID].path,
            _m3uTracks[trackPID].time,
            _m3uTracks[trackPID].title
          ];
          m3uWriter.file(m3uPath, m3uTime, m3uTitle);
        }
      }

      promiseArray[promiseArray.length] = writeFile(`${_appRootPath}${playList.name}.m3u`, m3uWriter.toString());
    }

    return Promise.all(promiseArray);
  })
  .then(() => {
    traceNotice('已完成同步', 'app');
  })
  .catch((error) => {
    traceError(error, 'app');
  });