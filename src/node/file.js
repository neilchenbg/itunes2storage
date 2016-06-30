import {traceNotice, traceError} from '../service/log';
import {readFile as fsReadFile, writeFile as fsWriteFile, stat as fsStat} from 'fs-promise';

const _traceError = (message, funcName) => {
  traceError(message, 'service.log', funcName);
};

const _traceNotice = (message, funcName) => {
  traceNotice(message, 'service.log', funcName);
};

const checkFile = (path) => {
  return new Promise((resolve, reject) => {
    fsStat(path)
      .then((stats) => {
        resolve(stats.isFile());
      })
      .catch((error) => {
        if(error.code == 'ENOENT') {
          resolve(false);
        } else {
          _traceError(error.toString(), checkFile.name);
          reject(`Failure to check directory "${path}"`);
        }
      });
  });
};

const checkDir = (path) => {
  return new Promise((resolve, reject) => {
    fsStat(path)
      .then((stats) => {
        resolve(stats.isDirectory());
      })
      .catch((error) => {
        if(error.code == 'ENOENT') {
          resolve(false);
        } else {
          _traceError(error.toString(), checkDir.name);
          reject(`Failure to check file "${path}"`);
        }
      });
  });
};

const readFile = (path) => {
  return fsReadFile(path, 'utf-8');
};

const writeFile = (path, content) => {
  return fsWriteFile(path, content, 'utf-8');
};

const readFileAsJSON = (path) => {
  return new Promise((resolve, reject) => {
    readFile(path)
      .then((content) => {
        let json = {};

        try {
          json = JSON.parse(content);
        } catch(error) {
          _traceError(error.toString(), readFileAsJSON.name);
          reject(`File "${path}" format is not correct`);
        }

        resolve(json);
      })
      .catch((error) => {
        _traceError(error.toString(), readFileAsJSON.name);
        reject(`Failure to read file "${path}"`);
      })
  });
};

const writeFileAsJSON = (path, json) => {
  return wf(path, JSON.stringify(json), 'utf-8');
};

const createDir = (path) => {
  return new Promise((resolve, reject) => {
    
  });
};

const createFile = (path) => {

};

export {
  checkFile,
  checkDir,
  readFile,
  writeFile,
  readFileAsJSON,
  writeFileAsJSON,
  createDir,
  createFile
};