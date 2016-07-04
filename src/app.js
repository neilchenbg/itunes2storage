import * as plist from 'plist';
import * as m3u from 'm3u';
import {decode} from 'urlencode';
import {isArray} from 'underscore';
import {traceNotice, traceError} from './service/log';
import {
  readFile,
  writeFile,
  deleteFile,
  copyFile,
  readFileAsJSON,
  writeFileAsJSON,
  mkDir,
  readDir,
  checkDir,
  checkFile
} from './node/file';

class App {
  App() {
    this.settings = {};
    this.package = {};
    this.tracks = {};
    this.playlists = {};
    this.playlistPath = '';
  }

  traceError(message, funcName) {
    traceError(message, 'App', funcName);
  }

  traceNotice(message, funcName) {
    traceNotice(message, 'App', funcName);
  }

  loadTracksFromFile() {
    let that = this;

    return new Promise((resolve, reject) => {
      readFileAsJSON(`${that.playlistPath}tracks.json`)
        .then((result) => {
          that.tracks = result;
          resolve();
        })
        .catch((error) => {
          that.tracks = {};
          that.traceError(error, 'getTracksFromFile');
          resolve();
        });
    });
  }

  loadItunesLibrary(libraryPath) {
    let that = this;

    return new Promise((resolve, reject) => {
      readFile(libraryPath)
        .then((result) => {
          let library = {};

          try {
            library = plist.parse(result);
          } catch(e) {
            that.traceError(e.toString(), 'loadItunesLibrary');
            reject(`無法解析資料庫XML檔案，路徑: ${libraryPath}`);
          }

          resolve(library);
        })
        .catch((error) => {
          that.traceError(error, 'loadItunesLibrary');
          reject(`無法讀取資料庫XML檔案，路徑: ${libraryPath}`);
        });
    });
  }

  getPlaylistsAndTracksFromLibrary(library) {
    let that = this,
        playLists = [],
        trackIds = [],
        tracks = {};

    if (library['Playlists'] && isArray(library['Playlists']) && library['Playlists'].length > 0) {
      for (let playList of library['Playlists']) {
        if (
          playList['Name'] &&
          playList['Name'].indexOf(that.settings.playlistPrefix + '_') != -1 &&
          playList['Playlist Items'] &&
          isArray(playList['Playlist Items'])
        ) {
          let tmpTrackIds = [];

          for (let playListItem of playList['Playlist Items']) {
            if(library['Tracks'][playListItem['Track ID']]) {
              trackIds[trackIds.length] = playListItem['Track ID'];
              tmpTrackIds[tmpTrackIds.length] = library['Tracks'][playListItem['Track ID']]['Persistent ID'];
            }
          }

          playLists[playLists.length] = {
            pid: playList['Playlist Persistent ID'],
            name: playList['Name'].replace(that.settings.playlistPrefix + '_', ''),
            tracks: tmpTrackIds
          };
        }
      }
    }

    trackIds = [...new Set(trackIds)];

    for (let trackId of trackIds) {
      if (!library['Tracks'][trackId]) {
        continue;
      }

      let trackItem = library['Tracks'][trackId],
          trackSrc = decode(trackItem['Location']);

      if (trackSrc.indexOf('file://localhost/') != -1) {
        trackSrc = trackSrc.replace('file://localhost/', '');
      } else if(trackSrc.indexOf('file://') != -1) {
        trackSrc = trackSrc.replace('file://', '');
      }

      let [trackPID, trackName, trackArtist, trackAlbum, trackDiskNumber, trackNumber, trakcExt, trackModified, trackTotalTime] = [
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

      let trackNewName = `${trackArtist} - ${trackAlbum} ${trackDiskNumber}-${trackNumber} ${trackName}.${trakcExt}`,
          trackNewPath = `${that.settings.targetPath}${trackNewName}`,
          trackNewM3uPath = `../${trackNewName}`;

      tracks[trackPID] = {
        pid: trackPID,
        title: `${trackAlbum} - ${trackArtist}`,
        path: trackNewM3uPath,
        src: trackSrc,
        dest: trackNewPath,
        time: trackTotalTime,
        modified: trackModified
      };
    }

    return [playLists, tracks];
  }

  updateTracks(tracks) {
    let that = this;

    return new Promise((resolve, reject) => {
      let trackPIds = new Set(),
          trackPIdsLast = new Set(),
          promiseArray = [];

      for (let trackPId in tracks) {
        trackPIds.add(trackPId);
      }

      for (let trackPId in that.tracks) {
        trackPIdsLast.add(trackPId);
      }

      let addTrackPIds = [...new Set([...trackPIds].filter(x => !trackPIdsLast.has(x)))],
          updateTrackPIds = [...new Set([...trackPIds].filter(x => trackPIdsLast.has(x)))],
          deleteTrackPIds = [...new Set([...trackPIdsLast].filter(x => !trackPIds.has(x)))];

      let [addCount, updateCount, deleteCount] = [0, 0, 0];

      for (let trackPId of addTrackPIds) {
        promiseArray[promiseArray.length] = copyFile(tracks[trackPId]['src'], tracks[trackPId]['dest']);
        addCount += 1;
      }

      for (let trackPId of updateTrackPIds) {
        if(tracks[trackPId]['modified'].toString() != new Date(that.tracks[trackPId]['modified']).toString()) {
          promiseArray[promiseArray.length] = copyFile(tracks[trackPId]['src'], tracks[trackPId]['dest']);
          updateCount += 1;
        }
      }

      for (let trackPId of deleteTrackPIds) {
        promiseArray[promiseArray.length] = deleteFile(that.tracks[trackPId]['dest']);
        deleteCount += 1;
      }

      promiseArray[promiseArray.length] = writeFileAsJSON(`${that.playlistPath}tracks.json`, tracks);

      Promise
        .all(promiseArray)
        .then((result) => {
          that.traceNotice(`同步清單完成，新增 ${addCount} 首歌曲，更新 ${updateCount} 首歌曲，移除 ${deleteCount} 首歌曲`, 'updateTracks');
          resolve();
        })
        .catch((error) => {
          that.traceError(error, 'updateTracks');
          reject(`處理歌曲清單錯誤`);
        });
    });
  }

  updatePlaylists(playlists, tracks) {
    let that = this;

    return new Promise((resolve, reject) => {
      let promiseArray = [];

      for (let playList of playlists) {
        let m3uWriter = m3u.extendedWriter();

        m3uWriter.comment(`Play list create by ${that.package.name}, author: ${that.package.author}`);
        m3uWriter.write();

        for (let trackPID of playList.tracks) {
          if (tracks[trackPID]) {
            let [m3uPath, m3uTime, m3uTitle] = [
              tracks[trackPID]['path'],
              tracks[trackPID]['time'],
              tracks[trackPID]['title']
            ];
            m3uWriter.file(m3uPath, m3uTime, m3uTitle);
          }
        }

        promiseArray[promiseArray.length] = writeFile(`${that.playlistPath}${playList.name}.m3u`, m3uWriter.toString());
      }

      Promise
        .all(promiseArray)
        .then((result) => {
          that.traceNotice(`處理播放清單完成`, 'updatePlaylists');
          resolve();
        })
        .catch((error) => {
          that.traceError(error, 'updatePlaylists');
          reject(`處理播放清單錯誤`);
        });
    });
  }

  run() {
    let that = this;

    return new Promise((resolve, reject) => {
      Promise
        .all([
          readFileAsJSON('settings.json'),
          readFileAsJSON('package.json')
        ])
        .then((result) => {
          [that.settings, that.package] = result;

          that.traceNotice(`載入設定檔案完成`, 'run');

          return checkDir(that.settings.targetPath);
        })
        .then((result) => {
          that.playlistPath = `${that.settings.targetPath}_${that.package.name}/`;

          return mkDir(that.playlistPath);
        })
        .then((result) => {
          that.traceNotice(`建立播放清單資料夾 "${that.playlistPath}" 完成`, 'run');

          return that.loadTracksFromFile();
        })
        .then((result) => {
          that.traceNotice(`讀取歌曲清單完成`, 'run');

          return that.loadItunesLibrary(that.settings.itunesXMLPath);
        })
        .then((result) => {
          that.traceNotice(`讀取itunes資料庫完成，資料庫版本: ${result['Application Version']}`, 'run');

          let [playlists, tracks] = that.getPlaylistsAndTracksFromLibrary(result);

          return Promise.all([
            that.updateTracks(tracks),
            that.updatePlaylists(playlists, tracks)
          ]);
        })
        .then((result) => {
          resolve('執行完成');
        })
        .catch((error) => {
          that.traceError(error, 'run');
          reject('執行失敗');
        });
    });
  }
}

let app = new App();
app
  .run()
  .then((result) => {
    console.log(result);
  })
  .catch((error) => {
    console.log(error);
  });