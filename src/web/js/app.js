var app = angular.module('symbiose', [
'ui.bootstrap',
'ngSanitize',
'pascalprecht.translate',
'angular-electron',
'ui.sortable'
    ]);

app.config(['$translateProvider', function($translateProvider) {
  $translateProvider.useStaticFilesLoader({
    prefix: 'locales/',
    suffix: '.json'
  });
  var remote = require('electron').remote;
  var lang = remote.app.getLocale();
  $translateProvider.preferredLanguage(lang).fallbackLanguage('en');
}]);

app.filter("trustUrl", ['$sce', function ($sce) { //used by media player
    return function (recordingUrl) {
        return $sce.trustAsResourceUrl(recordingUrl);
    };
}]);

app.controller('mainCtrl', ['$scope', '$http', '$rootScope', '$translate' ,'$window', '$location', 'ipcRenderer', 'BrowserWindow', function($scope, $http, $rootScope, $translate, $window, $location, ipcRenderer, BrowserWindow)
{
  $scope.page = "gallery";   //default page

  ipcRenderer.send("retreiveLocalGallery");

  $scope.setPage = function(page){
    console.log("Setting page "+page);
    $scope.page = page;
    if(!$scope.$$phase) {
      $scope.$apply();
    }
  };

  //player logged
  ipcRenderer.on("updateDownloading", function(update){
    $rootScope.updateDownloading = true;
    if(!$scope.$$phase) {
      $scope.$apply();
    }
  });

  ipcRenderer.on("gallery", function(gallery){
    $rootScope.gallery = gallery;
    if(!$scope.$$phase) {
      $scope.$apply();
    }
  });

  ipcRenderer.on("updateAvailable", function(){
    $rootScope.updateAvailable = true;
    if(!$scope.$$phase) {
      $scope.$apply();
    }
  });

  ipcRenderer.on("wallpaperSaved", function(event, wallpaper){
    if(!wallpaper){
      return;
    }
    $rootScope.settings.downloadingWallpapers[wallpaper.id].downloading = false;
    $rootScope.settings.downloadingWallpapers[wallpaper.id].added = true;
    $rootScope.settings.values.gallery.wallpapers.push(wallpaper);
    $rootScope.settings.save();
  });

  $rootScope.installUpdate = function(){
    ipcRenderer.send("installUpdate");
  };

  $rootScope.sources = ipcRenderer.sendSync('sources');

  //full screen image preview
  $rootScope.preview = {
    wallpaper: null,
    set: function(wallpaper, isLocal){

      //if local wallpaper then convert the uri
      if(isLocal){
        wallpaper.localUri = $rootScope.getLocalUri(wallpaper.localUri);
      }

      $rootScope.preview.wallpaper = wallpaper;
      ipcRenderer.send("setFullScreen", true);
      if(!$scope.$$phase) {
        $scope.$apply();
      }
    },
    close: function(){
      $rootScope.preview.wallpaper = null;
      ipcRenderer.send("setFullScreen", false);
    }
  };

  $rootScope.getLocalUri = function(uri){
    if(!uri){
      return;
    }
    var r = ipcRenderer.sendSync("getLocalUri", uri);
    return r;
  };

  // send a nav event for the main process (close minify maximize...)
  $rootScope.frameInteraction = function(interaction){
    ipcRenderer.send('frameInteraction', interaction);
  };

  $rootScope.settings = {
    values: null,
    downloadingWallpapers: {},
    saveWallpaper: function(wallpaper){

      this.downloadingWallpapers[wallpaper.id] = {
        downloading: true,
        added: false
      };

      if(!$rootScope.settings.values.gallery.wallpapers){
        $rootScope.settings.values.gallery.wallpapers = [];
      }
      ipcRenderer.send('saveWallpaper', wallpaper);
    },
    removeWallpaper: function(wallpaper){
      ipcRenderer.send('removeWallpaper', wallpaper);
      var i = _.indexOf(this.values.gallery.wallpapers, wallpaper);
      if(i > -1){
        this.values.gallery.wallpapers.splice(i, 1);
        this.save();
      }
      else{
        console.log("Error");
      }

    },
    save: function(){
      ipcRenderer.send('saveSettings', this.values);
      console.log(this.values);
    }
  };

  //retreive the settings
  $rootScope.settings.values = ipcRenderer.sendSync('getSettings');
  console.log($rootScope.settings.values);
  //load the assistant
  if($rootScope.settings.values.local.enableAssistant === true){
    $scope.setPage('assistant');
  }
  if(!$scope.$$phase) {
    $scope.$apply();
  }

}]);
