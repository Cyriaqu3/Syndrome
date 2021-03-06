var electron = require('electron');
var {app, Menu, Tray, webContents} = require('electron');
var Menu = electron.Menu;
var BrowserWindow = electron.BrowserWindow;
var GhReleases = require('electron-gh-releases');
var ipc = electron.ipcMain;
var childProcess = require('child_process');
var path = require('path');
var appFolder = path.resolve(process.execPath, '..');
var rootAtomFolder = path.resolve(appFolder, '..');
var updateDotExe = path.resolve(path.join(rootAtomFolder, 'Update.exe'));
var exeName = "Symbiose.exe";
var nodeWallpaper = require('wallpaper');
require('electron-debug')({showDevTools: true});
var regedit = require('regedit');
var mainFrame;
var overlayFrame;
var overlayEnabled = false;
var wallpaperProcess = null;
var renderIpc;
var screens;
//retreive package.json properties
var pjson = require('./package.json');
var sources = require('./sources.json');

//Settings file (default)
var settings = {
  local: {
    localSettingsFile: app.getPath("appData")+"\\"+pjson.name+"\\"+pjson.name+".json",
    syncedPath: null,
    tempDir: app.getPath("temp")+"\\"+pjson.name+"\\",
    localDir: app.getPath("appData")+"\\"+pjson.name+"\\",
    enableAssistant: true,
    managedByOS: true,
    slideshow: {
      changeOnStartup: true,
      changeDelay: 3,
      items: []
    }
  },
  gallery: {
    wallpapers: []
  },
  explore: {
    excludedSources: []
  }
};
var util = require('util');
var port = 80;
var request = require('request');
var os = require('os');
var _ = require('lodash');
var bodyParser = require('body-parser');
var ws = require('windows-shortcuts');
var objectPath = require("object-path");
var probe = require('probe-image-size');
var fs = require('fs-extra');
var url = require('url');
var Jimp = require("jimp");
var readChunk = require('read-chunk');
var async = require('async');
var schedule = require('node-schedule');
//img buffer keys
var magic = {
    jpg: 'ffd8ffe0',
    png: '89504e47',
    gif: '47494638'
};

var wallpaperJob;

console.log("Symbiose V."+pjson.version);

//Define updater options
var options = {
  repo: 'Cyriaqu3/Symbiose',
  currentVersion: pjson.version
};
var updater = new GhReleases(options);

// create the "temp" folder
if (!fs.existsSync(settings.local.tempDir)){
  fs.mkdirSync(settings.local.tempDir);
}


// Hook the squirrel update events
if (handleSquirrelEvent()) {
  // squirrel event handled and app will exit in 1000ms, so don't do anything else
  return;
}

function handleSquirrelEvent() {
  if (process.argv.length === 1) {
    return false;
  }

  var spawn = function(command, args) {
    var spawnedProcess, error;

    try {
      spawnedProcess = childProcess.spawn(command, args, {detached: true});
    } catch (error) {}

    return spawnedProcess;
  };

  var spawnUpdate = function(args) {
    return spawn(updateDotExe, args);
  };

  var squirrelEvent = process.argv[1];

  var exePath = app.getPath("exe");
  var lnkPath = ["%APPDATA%/Microsoft/Windows/Start Menu/Programs/Symbiose.lnk",
  "%UserProfile%/Desktop/Symbiose.lnk"];

  switch (squirrelEvent) {
    case '--squirrel-install':
    case '--squirrel-updated':
      // Optionally do things such as:
      // - Add your .exe to the PATH
      // - Write to the registry for things like file associations and
      //   explorer context menus

      //write in the registry if windows OS
      if(process.platform === 'win32') {
        registerRegistry();
      }

      // Install desktop and start menu shortcuts


      //create windows shortcuts (remove previous if existing)
      if(process.platform === 'win32') {
        for (var i = 0; i < lnkPath.length; i++) {

          //remove shortcut if exist
          if(fs.existsSync(lnkPath[i])){
            fs.unlinkSync(lnkPath[i]);
          }

          //create new shortcut
          ws.create(lnkPath[i], {
              target : exePath,
              desc : pjson.description
          });
        }
      }
      setTimeout(app.quit, 1000);
      return true;

    case '--squirrel-uninstall':
      // Undo anything you did in the --squirrel-install and
      // --squirrel-updated handlers
      spawnUpdate(['--removeShortcut', exeName]);

      // Remove desktop and start menu shortcuts
      if(process.platform === 'win32') {
        for (var a = 0; a < lnkPath.length; a++) {
          fs.access(lnkPath[i], fs.F_OK, function(err) {
              if (!err) {
                fs.unlink(lnkPath[i]);
              }
          });
        }
      }

      setTimeout(app.quit, 1000);
      return true;

    case '--squirrel-obsolete':
      // This is called on the outgoing version of your app before
      // we update to the new version - it's the opposite of
      // --squirrel-updated

      app.quit();
      return true;
  }
}

app.on('window-all-closed', function () {
  //nothing
});


//app is ready to start
app.on('ready', function(){
  screens = electron.screen.getAllDisplays();
  //load/check settings first
  initApp(function(){
    //check for updates
    checkUpdates();
    //preload the frames
    loadFrames();
    //generate the system tray icon
    generateTray();
  });
});

app.on('activate', function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {

  }
});

//generate tray icon and associated actions
function generateTray(){
  tray = new Tray(__dirname + '/web/img/tgf/icon_circle.png');
  // right click context menu
  var contextMenu = Menu.buildFromTemplate([
    {
      label: 'Next wallpaper'
    },
    {
      type: 'separator'
    },
    {
      label: 'Gallery',
      click: function(){
        global.openApp();
      }
    },
    {
      label: 'Settings',
      click: function(){
        global.openApp();
      }
    },
    {
      label: 'Quit',
      click: function(){
        app.quit();
      }
    }
  ]);
  tray.on('click', function(){
    global.toggleOverlay();
  });
  tray.setToolTip('Symbiose is running...');
  tray.setContextMenu(contextMenu);
}

global.openApp = function(){
  mainFrame.show();
  mainFrame.focus();
};

//open or close the overlay : force = open or close
global.toggleOverlay = function(force){
  if(force === 'close'){
    overlayFrame.hide();
    overlayEnabled = false;
    return;
  }
  if(!overlayEnabled || force === 'open'){
    overlayFrame.show();
    overlayFrame.focus();
    overlayEnabled = true;
  }
  else{
    overlayFrame.hide();
    overlayEnabled = false;
  }
};

//open the tagifier main process
function loadFrames(){

  //main frame (settings / gallery etc...)
  mainFrame = new BrowserWindow({
    show: false,
    resizable: true,
    frame: false,
    icon: __dirname + '/web/img/tgf/icon_circle.png'
  });

  //slideshow : widget overlay who appear when user click on tray icon
  //calc the dimensions for the overlay
  var overlayDim = getOverlayDimensions(screens);

  overlayFrame = new BrowserWindow({
    x: overlayDim.x,
    y: overlayDim.y,
    show: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    transparent: true,
    icon: __dirname + '/web/img/tgf/icon_circle.png',
    frame: false,
    width: overlayDim.w,
    height: overlayDim.h
  });

  mainFrame.loadURL('file://' + __dirname + '/web/index.html', {extraHeaders: 'pragma: no-cache\n'});

  //display the main app and close the
  mainFrame.once('ready-to-show', function(){

    //hide menu bar
    mainFrame.setMenu(null);
  });



  overlayFrame.loadURL('file://' + __dirname + '/web/overlay.html', {extraHeaders: 'pragma: no-cache\n'});

  //display the main app and close the
  overlayFrame.once('ready-to-show', function(){

    //hide menu bar
    overlayFrame.setMenu(null);
  });
}

function getOverlayDimensions(screens){
  var dim = {
    x: 0,
    y: 0,
    w: 0,
    h: 150
  };
  // overlay is stuck at the bottom with full width and height = 150px
  dim.y = screens[0].workAreaSize.height - dim.h;
  dim.w = screens[0].workAreaSize.width;
  return dim;
}

function initApp(callback){
  checkSettings(function(openAssistant){

    // Stop if the app must open in assistant mode
    if(openAssistant === true){
      return callback();
    }

    //scan the wallpapers then open the app and start wallpaper job
    checkWallpapers(function(){
      return callback();
    });

  });
}

//Used for calling a global function from the client
ipc.on('mainProcessCall', function(event, func, args) {
  var w = BrowserWindow.fromWebContents(event.sender.webContents);
  global[func](args);
  global.toggleOverlay('close');
});

//send the wallpaper sources to the client when asked
ipc.on('sources', function(event) {
  event.returnValue = sources;
  renderIpc = event.sender;
});

ipc.on('frameInteraction', function(event, interaction){
  var w = BrowserWindow.fromWebContents(event.sender.webContents);
  if(w){
    w[interaction]();
  }
});

ipc.on('getSettings', function(event) {
  event.returnValue = settings;
  renderIpc = event.sender;
});

ipc.on('exist', function(event, path) {
  var r = true;
  fs.access(path, fs.constants.R_OK | fs.constants.W_OK, function(err){
    if(err){
      r = false;
    }
    event.returnValue = r;
  });

});

//return the converted localUri to the client
ipc.on('getLocalUri', function(event, uri){
  var u = uri.replace('%localDir%', settings.local.syncedPath);
  var r = url.parse(u).href;
  event.returnValue = r;
});

ipc.on('getJson', function(event, path) {
  fs.readJson(path, function (err, result) {
    if(err){
      event.returnValue = false;
      return;
    }
    event.returnValue = result;
  });
});

ipc.on('createFile', function(event, file, data) {
  //to complete -> write data in created file
  fs.ensureFile(file, function (err) {
    if(err){
      event.returnValue = false;
    }
    else{
      event.returnValue = true;
    }
  });
});

ipc.on('saveSettings', function(event, data){
  settings = data;
  saveSettings(settings, function(err){
    event.sender.send('settingsSaved');
  });
});

ipc.on('setFullScreen', function(event, setFullScreen){
  mainFrame.setFullScreen(setFullScreen);
  mainFrame.setAlwaysOnTop(setFullScreen);
});


//client ask for wallpapers
ipc.on('retreiveData', function(event, queryId, uriType, search, excludedSources) {

  var elems = {
    added: [],
    expected: 0
  };
  var sl = [];
  for (var sourceName in sources) {
    //check if source isn't in excluded list
    if(excludedSources[sourceName]){
      sl.push(sources[sourceName]);
    }
  }

  sl.forEach(function(source){
    requestData(event, queryId, elems, search, uriType, source, function() {
        console.log("Process done !");
        console.log(elems.added.length + " elements parsed");
        event.sender.send('queryEnd', queryId);
    });
  });
});

ipc.on('restart', function(event){
  app.relaunch({args: process.argv.slice(1).concat(['--relaunch'])});
  app.exit(0);
});

ipc.on('setWallpaper', function(event, wallpapers){
  createWallpaper(wallpapers, screens, function(image){
    event.sender.send('wallpaperSet', image);
  });
});

//save a wallpaper to the user gallery
ipc.on('saveWallpaper', function(event, wallpaper){
  var lUri = settings.local.syncedPath+"\\"+wallpaper.id+"."+wallpaper.type;
  console.log(wallpaper.localUri);
  console.log(url.parse(lUri).href);
  fs.copy(wallpaper.localUri, lUri, function(err){
    if(err){
      console.log(err);
      event.returnValue = false;
      return;
    }
    console.log("Wallpaper downloaded");
    lUri = "%localDir%\\"+wallpaper.id+"."+wallpaper.type;
    wallpaper.localUri = lUri;
    event.sender.send('wallpaperSaved', wallpaper);
  });
});

ipc.on('removeWallpaper', function(event, wallpaper){
  var u = wallpaper.localUri.replace('%localDir%', settings.local.syncedPath);
  fs.remove(u, function (err) {
    if (err){
      console.log(err);
    }
    console.log('success!');
  });

});

function saveSettings(settings, callback){

  //write the local values into the local file
  fs.writeJson(settings.local.localSettingsFile, settings.local, function(err){
    if(err){
      return callback(err);
    }

    // if synced path set then save sync settings into it
    if(settings.local.syncedPath){
      var syncedData = {};
      for (var prop in settings) {
        if(prop !== "local"){
          syncedData[prop] = settings[prop];
        }
      }
      fs.writeJson(settings.local.syncedPath+"\\symbiose.json", syncedData, function (err) {
        console.log("Settings saved syncedly");
        return callback();
      });
    }
    else{
      console.log("Local settings saved, synced path not defined !");
      return callback(null);
    }
  });
}

//request data from a resource

function requestData(event, queryId, elems, search, uriType, source, callback){
  //Set base if uritype is not defined
  if(!uriType){
    uriType = "base";
  }

  var currentSource = source;
  var qUrl = currentSource.api.uris[uriType];

  //apply search pattern if this is a search query
  if(uriType === "search"){
    qUrl = qUrl.replace('%1', search);
  }

  //start the request
  request({url:qUrl}, function (error, response, body) {
    if(error){
      callback(error, null);
    }

    parseData(event, queryId, elems, JSON.parse(body), currentSource, function(data){
      callback(null, body);
      return;
    });
  });
}

//parse the data retreived from a source according to the saved schemas
function parseData(event, queryId, elems, data, source, callback){
  var required = ["id", "title", "url"];
  var wp = objectPath.get(data, source.api.wallpapers.path);
  elems.expected +=  wp.length;
  for (var i = 0; i < wp.length; i++) {
    var w = {};
    w.source = source;
    //pass through all properties and assign them following the model
    var abord = false;
    for (var prop in source.api.wallpapers) {
      if(prop !== "path"){
        w[prop] = objectPath.get(wp[i], source.api.wallpapers[prop]);
        // convert / filter urls
        if(prop === "url"){
          w[prop] = filterUrl(w[prop]);
        }
        //we check if the prop is required
        if(required.indexOf(prop) > -1 && (!w[prop] || w[prop] === "")){
          //one required prop is missing, told the script to not add the wallpaper at the end of the process
          console.log("Propertie "+prop+" is missing for wallpaper "+w.id+" , abording...");
          abord = true;
        }
      }
    }

    //create an unique id for each wallpaper
    w.id = genId(source, w);
    //stop if the file alreadyExist
    if(elems.added.indexOf(w.id) > -1){
      continue;
    }

    //send the file to the main process for checking and add advanced properties
    if(!abord){

      //download the image and add additionals informations
      processWallpaper(event, queryId, w, function(err, wallpaper){
        elems.added.push(wallpaper.id);
        if(err){
          console.log(err);
        }

        //if this is the last element : callback
        if(elems.added.length === elems.expected){
          callback();
        }
      });
    }
  }
}

//filter specifics url (like imgur)
function filterUrl(url){
  //convert imgur links
  var x = /https?:\/\/imgur\.com\/(.*?)(?:[#\/].*|$)/.exec(url);
  if(x){
    url = "http://i.imgur.com/%1.jpg".replace("%1", x[1]);
  }

  //convert artstation links
  if(url.indexOf() > -1){
    url.replace("/medium/", "/large/");
  }

  return url;
}

//download wallpaper and retreive additional informations
function processWallpaper(event, queryId, wallpaper, callback){
  request({
    url : wallpaper.url,
    encoding : null
  }, function(error, response, body) {
    if (error || response.statusCode !== 200 || body === undefined || body === "") {
      console.log(error);
      callback("REQUEST_ERROR" , wallpaper);
    }

    //check if the file is an image
    if(!isImage(body)){
      callback("INVALID_FORMAT", wallpaper);
    }

    // obtain the size /type of the image
    probe(wallpaper.url).then(function (result) {
      for (var prop in result) {
        wallpaper[prop] = result[prop];
      }

      var uri = url.parse(settings.local.tempDir+"/"+wallpaper.id+"."+wallpaper.type).href;
      //write the image to the disk
      fs.writeFile(uri, body, {
          encoding : null
      }, function(err) {

        if(err){

          console.log(err);

          callback("WRITE_ERROR" , wallpaper);

        }

        //save the image into the local temp folder
        wallpaper.localUri = uri;
        //send the wallpaper to the rende process
        event.sender.send('wallpaper', wallpaper, queryId);

        callback(null, wallpaper);

      });
    });
  });
}

function checkWallpapers(callback){
  var newWallpapers = [];


  //Check if every files referenced in the json are in the folder, else remove it
  for (var i = 0; i < settings.gallery.wallpapers.length; i++) {
    var u = settings.gallery.wallpapers[i].localUri.replace('%localDir%', settings.local.syncedPath);
    if (fs.existsSync(u)){
      settings.gallery.wallpapers[i].hidden = false;
    }
    //wallpaper not on disk anymore , we hide him...
    else{
      settings.gallery.wallpapers[i].hidden = true;
    }
  }

  var fileDetails = settings.gallery.wallpapers;

  fs.readdir(settings.local.syncedPath, function(err, items){
    if(err){
      console.log(err);
      return;
    }

    for (var f = 0; f < items.length; f++) {
      var itemPath = settings.local.syncedPath+"\\"+items[f];
      if(!fs.lstatSync(itemPath).isFile()){
        continue;
      }

      var data = readChunk.sync(itemPath, 0, 10);
      //check if file is a valid image
      if(!isImage(data)){
        continue;
      }

      //check if the file is stored inside the synced json and associate data if needed
      // substring = remove .jpg / .png etc...
      var index = _.findIndex(fileDetails, function(o) { return o.id == items[f].substring(0, items[f].length - 4); });
      if(index > -1){
        newWallpapers.push(fileDetails[index]);
      }
      else{
        newWallpapers.push({
          "id": path.parse(items[f]).name,
          "localUri": url.parse(itemPath.replace(settings.local.syncedPath, '%localDir%')).href
        });
        console.log("New wallpaper discovered");
        console.log(newWallpapers[newWallpapers.length-1]);
      }
    } //end items loop

    //replace with the refreshed value
    settings.gallery.wallpapers = newWallpapers;
    saveSettings(settings, function(){
      console.log("done");
      return callback();
    });

  });
}

function checkSettings(callback){
  var assistant = false;
  //create local settings file if not exist
  fs.ensureFile(settings.local.localSettingsFile, function (err) {
    if(err){
      settings.local.enableAssistant = true;
      return callback(true);
    }
    var sd = fs.readJsonSync(settings.local.localSettingsFile, {throws: false});
    if(sd === null){
      fs.writeJsonSync(settings.local.localSettingsFile, settings.local);
      console.log("Local settings file created");
    }
    else{
      console.log("Local settings loaded");
      settings.local = sd;
    }
    //if syncedSettings file is available
    if(settings.local.syncedPath){
      console.log("syncedSettings file available");
      // read the synced file and override params
      sd = fs.existsSync(settings.local.syncedPath+"\\symbiose.json");

      //can't read the defined json file
      if(!sd || sd === null){
        console.log("not readable");
        settings.local.enableAssistant = true;
        fs.writeJsonSync(settings.local.localSettingsFile, settings.local);
        assistant = true;
      }

      for (var param in sd) {
        //ignore local params
        if(param === "local"){
          continue;
        }
        settings[param] = sd[param];
      }
      settings.local.enableAssistant = false;
      fs.writeJsonSync(settings.local.localSettingsFile, settings.local);
      console.log("synced settings loaded and applied");
    }
    //json file not defined
    else{
      console.log("not defined");
      settings.local.enableAssistant = true;
      fs.writeJsonSync(settings.local.localSettingsFile, settings.local);
      assistant = true;
    }

    //check if the slideshow isnt empty, else add the default gallery
    if(settings.local.slideshow.items.length === 0){
      var t = {
        type: "gallery"
      }
      settings.local.slideshow.items.push(t);
      fs.writeJsonSync(settings.local.localSettingsFile, settings.local);
    }

    return callback(assistant);

  });

}

//generate an unique id for each wallpaper
function genId(source, wallpaper){
  var i = 0;
  for (var s in sources) {
    if(sources[s].label === source.label){
      break;
    }
    i++;
  }
  return i+"-"+wallpaper.id;
}

function checkUpdates(){

  // Check for updates
  // `status` returns true if there is a new update available
  console.log("Looking for update");
  updater.check((err, status) => {
    if(err){
      console.log("No new version / unable to check");
      console.log("details :");
      console.log(err);
    }
    //update available
    else{
      // Download the update
      updater.download();
      ipc.emit("updateDownloading");
    }
  });

  // When an update has been downloaded
  updater.on('update-downloaded', (info) => {
    console.log(info);
    ipc.emit("updateAvailable", info);
  })
}

// client request update instalation
ipc.on('installUpdate', function (fileData) {
  updater.install();
});

//wallpapers = array of wallpaper object
function createWallpaper(wallpapers, screens, callback){

  //spawn a new process (prevent freeze)
  if(wallpaperProcess){
    wallpaperProcess.kill();
  }
  wallpaperProcess = childProcess.fork('wallpaper.js', {
    cwd: __dirname
  });

  var options = {
    wallpapers: wallpapers,
    screens: screens,
    settings: settings,
    callback: callback
  };

  wallpaperProcess.send({ options: options });
  wallpaperProcess.on('message', function(e){
    callback(e.result);
  });
  wallpaperProcess.on('exit', function (code, signal) {
    console.log('wallpaper Process exited:', code, signal);
  });
}

function rmDir(dirPath, removeSelf) {
  if (removeSelf === undefined)
    removeSelf = true;
  try { var files = fs.readdirSync(dirPath); }
  catch(e) { return; }
  if (files.length > 0)
    for (var i = 0; i < files.length; i++) {
      var filePath = dirPath + '/' + files[i];
      if (fs.statSync(filePath).isFile())
        fs.remove(filePath);
      else
        rmDir(filePath);
    }
  if (removeSelf)
    fs.rmdirSync(dirPath);
}

function isImage(data){
  var bb = data.toString('hex',0,4);
  if (bb === magic.jpg ||
      bb === magic.png ||
      bb === magic.gif) {
        return true;
  }
  return false;
}

rmDir(settings.local.tempDir, false);
console.log("Temp files cleaned");
