var fs = require('fs');
var util = require('util');
var events = require('events');
var path = require('path');

var DIR_CREATE_MODE = 0766;

var copyDir = function copyDir(src, dst, exclude, callback) {
  var copying = 0;

  var cb = function(err, src, dst) {
    copying --;

    if (err || !copying) {
      callback(err, src, dst);
    }
  }

  function copyItems(items) {
    if (!items.length) {
      copying ++;
      cb(null, src, dst);
      return;
    }

    items.forEach(function(item) {
        copying ++;

        new copy(
          src + '/' + item, 
          dst + '/' + item, 
          exclude,
          cb
        );
      });
  }

  function getItems() {
    fs.readdir(src, function(err, items) {
      if (err) {
        cb(err, src, dst);
      }
      copyItems(items);
    })
  }

  function createDst() {
    fs.mkdir(dst, DIR_CREATE_MODE, function(err) {
      if (err) {
        cb(err, src, dst);
      }

      getItems();
    }) 
  }

  createDst();
  
}

var copy = function copy(src, dst, exclude, callback) {
  var self = this;
  
  function matchExcludeList(file) {
    var test;
    // abs path
    if (file.indexOf('/') == 0) {
      test = file;
    }
    // rel path
    else {
      test = path.dirname(src) + '/'+ file;
    }

    if (src == test) {
      return true;
    }
  }

  self.on('error', function(err) {
    callback(err, src, dst);
  });

  self.on('validations', function() {

    path.exists(src, function(exists) {
      var excludeFile = false;

      if(!exists) {
        self.emit('error', new Error(src + ' does not exist. Nothing to be copied.'));
        return;
      }

      // exclude it, but not an error
      if (exclude.some(matchExcludeList)) {
        return callback(null, src, dst);
      }

      fs.stat(src, function(err, stat) {

        if(err) {
          self.emit('error', err);
          return;
        }

        if(src == dst) {

          self.emit('error', new Error(src + ' and ' + dst + 'are identical'));
          return;
        }
        
        if(stat.isDirectory()) {
          copyDir(src, dst, exclude, callback);
        }
        else {
          self.emit('open_infd'); 
        }
      });
    });
  });

  self.on('open_infd', function() {

    fs.open(src, 'r', function(err, infd) {

      if(err) {

        self.emit('error', err);
        return;
      }

      self.emit('open_outfd', infd);
    });

  });

  self.on('open_outfd', function(infd) {

    fs.open(dst, 'w', function(err, outfd) {

      if(err) {

        self.emit('error', err);
        return;
      }

      self.emit('sendfile', infd, outfd);
    });
  });

  self.on('sendfile', function(infd, outfd) {

    fs.fstat(infd, function(err, stat) {

      if(err) {

        self.emit('error', err);
        return;
      }
      
      fs.sendfile(outfd, infd, 0, stat.size, function() {

        self.emit('close_fds', infd, outfd);
        callback(null, src, dst);
      });
    });
  });

  self.on('close_fds', function(infd, outfd) {

    fs.close(infd, function(err) {

      if(err) {
        self.emit('error', err);
      }

    });

    fs.close(outfd, function(err) {

      if(err) {

        self.emit('error', err);
      }

    });
  });

  self.emit('validations');
};
util.inherits(copy, events.EventEmitter);

function parseArgs(args) {
  var inputs = {
    src: '',
    dst: '',
    callback: function() {},
    exclude: []
  };

  if (args.length > 1) {
    inputs.src = args[0];
    inputs.dst = args[1];
  }

  if (args.length == 3) {
    if (typeof args[2] == 'function') {
      inputs.callback = args[2];
    }
    else {
      inputs.exclude = args[2];
    }
  }
  else if (args.length == 4) {
    inputs.callback = args[3];
    inputs.exclude = args[2];
  }

  return inputs;
}
   
exports.copy = function(src, dst) {
  var args = parseArgs(arguments);
  return new copy(args.src, args.dst, args.exclude, args.callback);
};

var copyDirSync = function copyDirSync(src, dst) {
  var contents = fs.readdirSync(src);

  if(!path.existsSync(dst)) {
    fs.mkdirSync(dst, DIR_CREATE_MODE);
  }

  contents.forEach(function(item) {
    exports.copySync(
      src + '/' + item, 
      dst + '/' + item
    );
  });
}

exports.copySync = function copySync(src, dst) {
  if(!dst) {
		throw new Error('Destination is not defined.');
  } 

  if(!path.existsSync(src)) {
    throw new Error(src + ' does not exist.');
  }

  if(src == dst) {
    throw new Error(src + ' and ' + dst + 'are identical.');
  }

  if(fs.statSync(src).isDirectory()) {
      copyDirSync(src, dst);
      return;
  }

  var infd = fs.openSync(src, 'r');
  var size = fs.fstatSync(infd).size;
  var outfd = fs.openSync(dst, 'w');

  fs.sendfileSync(outfd, infd, 0, size);

  fs.close(infd);
  fs.close(outfd);
};