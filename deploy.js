var async = require('async'),
  _ = require('lodash'),
  dir = require('node-dir'),
  fs = require('fs'),
  heroku = require('./deploy/heroku'),
  mime = require('mime'),
  request = require('request'),
  util = require('util');

require('shelljs/global');

var _command = function(cmd) {
  return exec(cmd, {silent: true}).output.replace(/\n/, '');
};

var username = function() {
  var user = _command("git config user.email");
  if (user == '')
    user = process.env.DEPLOY_USER;
  return user;
};

var Deployer = function(app, done, log) {
  this.app = app;
  this.done = done;
  this.bundleExts = ['js', 'css'];
  this.bundlePaths = {};
  this.log = log;
  this.version = process.env.BUNDLE_VERSION;

  this.awsContentUrlPrefix = process.env.AWS_S3_CONTENT_URL + '/';
};

Deployer.prototype.fail = function(err) {
  this.log.errorlns(err);
  this.done(false);
};

Deployer.prototype.upload = function(done) {
  this.log.subhead('uploading to S3');

  var s3 = new (require('aws-sdk')).S3();

  var upload = function(path, contents, type, done) {
    this.log.writeln(path);

    s3.putObject({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: path,
      Body: contents,
      ACL: 'public-read',
      ContentType: type
    }, done);
  }.bind(this);

  var version = this.version;

  dir.files('dist/deploy/pages', function(err, files) {
    if (err) throw err;
    async.each(files, function(filename, next) {
      var contents = fs.readFileSync(filename),
        path = filename.replace(/^dist\/deploy\/pages/, 'assets/' + version);

      upload(path, contents, mime.lookup(filename), next);
    }, done);
  });
};

Deployer.prototype.uploadSourceMap = function(callback) {
  this.log.subhead('uploading source map to Rollbar');

  var sourceMapFile = 'dist/deploy/pages/bundle.min.js.map';

  var formData = {
    // Pass a simple key-value pair
    access_token: process.env.ROLLBAR_SERVER_TOKEN,
    // Pass data via Buffers
    version: this.version,
    minified_url: this.awsContentUrlPrefix + this.bundlePaths.js,
    // Pass optional meta-data with an 'options' object with style: {value: DATA, options: OPTIONS}
    // See the `form-data` README for more information about options: https://github.com/felixge/node-form-data
    source_map: {
      value:  fs.createReadStream(sourceMapFile),
      options: {
        filename: sourceMapFile,
        contentType: 'application/octet-stream'
      }
    }
  };
  request.post({
    url: 'https://api.rollbar.com/api/1/sourcemap',
    formData: formData
  }, function (err, httpResponse, body) {
    if (err || body.err > 0) {
      console.error('upload failed:', err);
      this.fail(err.message);
    }
    callback();
  }.bind(this));
};

Deployer.prototype.notifyRollbar = function(callback) {
  this.log.subhead('notifying Rollbar of deploy');

  var formData = {
    access_token: process.env.ROLLBAR_SERVER_TOKEN,
    revision: require('./deploy/version')(),
    environment: process.env.NODE_ENV,
    local_username: username()
  };
  request.post({
    url:'https://api.rollbar.com/api/1/deploy/',
    formData: formData
  }, function (err, httpResponse, body) {
      if (err || body.err > 0) {
        this.fail(result.message);
      }
      callback();
    }.bind(this));
};

Deployer.prototype.updateEnv = function(callback) {
  this.log.subhead(util.format('updating BUNDLE_VERSION on %s: %s', this.app, this.version));
  heroku.config(this.app).update({BUNDLE_VERSION: this.version}, callback);
};

var api = {

  appName: function(target) {
    var name;
    if (target == 'staging') {
      name = 'hylo-node-staging';
    } else if (target == 'production') {
      name = 'hylo-node';
    }
    return name;
  },

  setupEnv: function(target, log, done) {
    log.subhead('setting up environment variables for deploy');

    process.env.BUNDLE_VERSION = require('./deploy/version')(8);
    log.writeln('BUNDLE_VERSION: ' + process.env.BUNDLE_VERSION);

    var appName = api.appName(target),
      keys = [
        'NODE_ENV',
        'ASSET_HOST_URL',
        'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET', 'AWS_S3_CONTENT_URL',
        'FACEBOOK_APP_ID',
        'FILEPICKER_API_KEY',
        'GOOGLE_BROWSER_KEY', 'GOOGLE_CLIENT_ID',
        'ROLLBAR_CLIENT_TOKEN', 'ROLLBAR_SERVER_TOKEN',
        'SEGMENT_KEY', 'STRIPE_PUBLISHABLE_KEY'
      ];

    log.writeln(util.format('fetching from %s: %s', appName, keys.join(', ')));

    heroku.config(appName).info(function(err, vars) {
      _.extend(process.env, _.pick(vars, keys));
      done(err);
    });
  },

  run: function(target, done, log) {
    var deployer = new Deployer(api.appName(target), done, log);

    async.series([
      deployer.upload.bind(deployer),
      deployer.uploadSourceMap.bind(deployer),
      deployer.notifyRollbar.bind(deployer),
      deployer.updateEnv.bind(deployer)
    ], function(err) {
      if (err) {
        deployer.fail(err);
      } else {
        done();
      }
    });
  }

};

module.exports = api;
