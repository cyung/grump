var path   = require('path');
var fs     = require('fs.extra');
var http   = require('http');
var https  = require("follow-redirects").https;
var mkdirp = require('mkdirp');
var exec   = require('child-process-promise').exec;
var spawn  = require('child_process').spawn;
var prompt = require('prompt');
var _      = require('lodash');

var serverApiUrl = "http://localhost:3000/api/lib/";

// Local directory - wrap this around paths accessing the local
// node module folder and not the CWD grump is being executed from
var lodir = function(dir) {
  var newArgs = [__dirname];
  var args = Array.prototype.slice.call(arguments);
  newArgs = newArgs.concat(args);

  return path.join.apply(this, newArgs);
};

// Fetch and update config
var config = function() {
  return JSON.parse(fs.readFileSync(lodir('config.json'), 'utf-8'));
};

var updateConfig = function(obj) {
  fs.writeFileSync(lodir('config.json'), JSON.stringify(obj));
};

// Quick check to know if verbose messages should be displayed
var isVerbose = function() {
  return config().verbose === "true";
};

// Make the lib dir if it doesn't exist
var initialRun = function() {
  try {
    fs.mkdirSync(lodir('lib'));
  } catch (e) {}
};

// Scan lib directory for installed grumps
var getInstalledGrumps = function() {
  var grumps;
  try {
    var data = fs.readFileSync(lodir('lib/grumpTable.json'), 'utf-8');
    return JSON.parse(data);
  }
  catch(e) {
    return {};
  }
};


/*=============================
=            NOTES            =
=============================*/
/**
 *
 * validLocalGrump needs to be fixed
 *
 */



// Check if grump ( specific (keith/hello) or general (hello) ) exists
var validLocalGrump = function(grump, installedGrumps) {
  return installedGrumps.hasOwnProperty(grump);
};

// Query Grumpjs server for grump
var queryServer = function(grump, cb) {
  if (isVerbose()) console.log("Querying grumpjs server for " + grump.cyan);

  http.get(serverApiUrl + grump, function (res) {
    if (isVerbose()) console.log("Received statusCode " + res.statusCode.toString().green + " from server.");

    if (res.statusCode === 404) {
      cb("Error".red + ": " + grump.cyan + " was not found on the server.", null);
    } else if (res.statusCode > 500) {
      cb("Error".red + ": Something went wrong on grumpjs. Please try again later.", null);
    } else if (res.statusCode === 200) {
      var body = '';
      res.on('data', function(chunk) {
        body += chunk;
      });
      res.on('end', function() {
        body = JSON.parse(body);
        if (body.grumps.length === 0) {
          cb("Error".red + ": No matches for '" + grump.cyan + "' were found on server.", body);
        } else {
          cb(null, body);
        }
      });
      res.on('error', function(err){
        cb(err, null);
      });
    }
  })
  .on('error', function(err) {
    cb(err, null);
  });
};

var install = function(repo, installedGrumps, isUpdate) {

  var repoName = repo.repoName;
  var author  = repo.author;

  if (isVerbose()) { console.log("Installing " + author.green + "/" + repoName.cyan + "..."); }

  if(isUpdate) {
    fs.rmrfSync(lodir("lib", repoName, author));
  }

  mkdirp.sync(lodir("lib", repoName, author));
  // Recursively create command and author directory

  // Clone from github
  var gitCloneCommand = 'git clone ' + repo.cloneUrl + ' ' + lodir("lib", repoName, author);
  exec(gitCloneCommand)
  .fail(function (err) {
    console.log("Error".red + ": Something went wrong while attempting to clone " + grump.cyan + ".");
  })
  .then(function () {

    //get grump.json file
    var grumpjson = JSON.parse(fs.readFileSync(lodir("lib", repoName, author, "grump.json"), 'utf-8'));

    //get all of the commands in the grump.json file, and add it to our table entry
    for(var key in grumpjson.commands) {
      installScript(key);
    }

    if(isUpdate){
      trimTable(grumpjson);
    }
  
    fs.writeFileSync(lodir('lib', 'grumpTable.json'), JSON.stringify(installedGrumps), 'utf8');

    var successMessage = isUpdate ? "updated." : "installed."; 

    console.log("Grump ", author.green + "/".green + repoName.green, " successfully " + successMessage);

  })
  .fail(function (err) {
    console.log("error".red, err);
  });

  function trimTable (grumpjson) {

    for(var key in installedGrumps) {

      installedGrumps[key] = _.filter(installedGrumps[key], function (commandObj) {
        if(commandObj.author === author && commandObj.repoName === repoName) {
          var commandKey = commandObj.command;
          if(!grumpjson.commands[commandKey]) {
            return false;
          }
        }
        return true;
      });

      if(installedGrumps[key].length === 0) {
        delete installedGrumps[key];
      }
    }
  }


  function installScript (command) {

    var authorKey = author + ":" + command;
    var repoKey = repoName + ":" + command;
    var authorRepoKey = author + "/" + repoName + ":" + command;
    var commandKey = command;
    var grumps;

    var value = {
      repoName: repoName,
      author: author,
      command: command,
      path: lodir('lib', repoName, author)
    };

    var keys = [authorKey, repoKey, authorRepoKey, commandKey];
    
    for (var i = 0; i < keys.length; i++) {
      installedGrumps[keys[i]] = installedGrumps[keys[i]] || [];
      var grumpIndex = checkPackage(installedGrumps[keys[i]], value);
      if(grumpIndex !== -1) {
        installedGrumps[keys[i]][grumpIndex] = value;
      } else {
        installedGrumps[keys[i]].push(value);
      }
    }
  }

  function checkPackage (grumps, grump) {
    var pack;
    for(var i = 0; i < grumps.length; i++) {
      pack = grumps[i];
      if (pack.author === grump.author && pack.repoName === grump.repoName) {
        return i;
      }
    }
    return -1;
  }

};


var run = function(data, args) {
  var repoName = data.repoName;
  var author = data.author;
  var path = data.path;
  var command = data.command;

  var grumpjson;
  try {
    grumpjson = JSON.parse(fs.readFileSync(path + '/grump.json'));
  }
  catch(e) {
    console.err('Error: could not find grump.json');
  }

  // Extract default command config
  var file = grumpjson.commands[command].path;

  var grumpPath = path + '/' + file;
  // var grumpPath = lodir("lib", command, author, file);

  // Determine how to run the script
  var cmd = grumpjson.commands[command].run;

  // Set up arguments to be passed into spawn
  args.unshift(grumpPath);

  // Make backup of original script for variable injection
  copyGrump(grumpPath, function() {

    // Prompt for variables and store persistant values if first run
    checkVars(function() {

      // Finally, run the grump
      runGrump(cmd, args, function() {

        // And now, we can move the .bak file back to the original
        fs.copy(grumpPath + ".bak", grumpPath, { replace: true }, function(err) {
          if (err) {
            console.log("Error".red + ": Something went wrong while copying backup of grump.");
          }
          fs.unlink(grumpPath + ".bak", function(err) {
            if (err) {
              console.log("Error".red + ": Something went wrong while deleting backup of grump.");
            }
          });
        });
      });
    });

  });

  function copyGrump(grump, cb) {
    var from = grump;
    var to   = grump + ".bak";

    // Check if .bak file exists
    fs.stat(to, function(err, stat) {

      // Copy was never deleted which means execution was canceled half way through
      if (err === null) {

        // Swap which file to copy from/to since .bak holds the original
        // We don't need to make a backup...we need to restore the back up now.
        var tmp = from
        from = to;
        to = tmp;
      }

      // Perform copy
      fs.copy(from, to, { replace: true }, function(err) {
        if (err) {
          console.log("Error".red + ": Something went wrong while making copy of grump.");
        }
        cb();
      });

    });
  }

  function firstRun(cb) {
    if (grumpjson.stats === undefined) {
      //console.log("first run.");
      cb(true);
    } else {
      //console.log(grumpjson.stats.executions + " runs.");
      cb(false);
    }
  }

  function checkVars(cb) {
    var init;
    if (grumpjson.stats === undefined) {
      //console.log("first run.");
      init = true;
    } else {
      //console.log(grumpjson.stats.executions + " runs.");
      init = false;
    }

    promptVars(init, function(vars) {
      injectVariables(vars, function() {
        cb();
      });
    });
  }

  function promptVars(init, cb) {
    // Sort persist/non-persist vars
    var persist          = {};
    var non_persist      = {};
    var persist_keys     = [];
    var non_persist_keys = [];

    _.each(grumpjson.commands[command].vars, function(variable, key) {
      if (variable.persist && variable.persist.toString() === "true") {
        persist[key] = variable;
        persist_keys.push(key);
      } else {
        non_persist[key] = variable;
        non_persist_keys.push(key);
      }
    });

    var prompts = [];

    // Also ask persistant variables since this is the 1st time running this grump
    if (init) {
      var prompts = prompts.concat(persist_keys);
    }
    var prompts = prompts.concat(non_persist_keys);

    if (prompts.length === 0) {
      cb({});  // Pass in empty variables object since no vars are available
    } else {

      var variables = {};
      // If not first time, there are vars to fetch from grump.json
      if (!init) {
        variables = grumpjson.commands[command].persist_vars;
      }

      prompt.message = author.green + "/" + commandName.cyan;
      prompt.start();
      prompt.get(prompts, function (err, results) {

        // First time, so extract persist vars and save them to grump json
        if (init) {

          // Create new object to hold persist vars
          grumpjson.commands[command].persist_vars = {};

          _.each(results, function(result, key) {

            // Found a persist var
            if (persist_keys.indexOf(key) !== -1) {
              grumpjson.commands[command].persist_vars[key] = result;
            }
          });
        }

        variables = _.merge(_.clone(variables), _.clone(results));
        cb(variables);
      });
    }
  }

  function runGrump(cmd, args, cb) {

    var childProcess = spawn(cmd, args, {stdio: [
      0, // use parents stdin for child
      'pipe', // pipe child's stdout to parent
    ]});

    // Update grump stats
    updateStats();

    // Save grump.json file changes
    updateGrumpJSON(grumpjson);

    childProcess.stdout.on('data', function (data) {
      process.stdout.write(data);
    });

    childProcess.stderr.on('data', function (data) {
      process.stderr.write(data);
    });

    childProcess.on('close', function (code) {
      cb();
      //console.log('process exit code ' + code);
    });

    function updateStats() {
      if (grumpjson.stats === undefined) {
        grumpjson.stats = {};
        grumpjson.stats.executions = 1;
      } else {
        grumpjson.stats.executions += 1;
      }
    }
  }

  function updateGrumpJSON(obj) {
    fs.writeFileSync(lodir("lib", repoName, author, "grump.json"), JSON.stringify(obj));
  }

  function injectVariables(vars, cb) {
    // Read in file
    var contents = fs.readFile(grumpPath, 'utf-8', function(err, contents) {
      if (err) {
        console.log("Error".red + ": Something went wrong while attempting to read the grump file.");
      }

      // replace all occurances of variables with their values
      _.each(vars, function(value, key) {
        contents = contents.replace("grump_" + key, value);
      });

      // Write the new file
      fs.writeFile(grumpPath, contents, function(err) {
        if (err) {
          console.log("Error".red + ": Something went wrong while attempting to write the grump file.");
        }
        cb();
      });
    });
  }
};

exports.install = install;
exports.run = run;
exports.queryServer = queryServer;
exports.isVerbose = isVerbose;
exports.lodir = lodir;
exports.validLocalGrump = validLocalGrump;
exports.initialRun = initialRun;
exports.getInstalledGrumps = getInstalledGrumps;
exports.config = config();
exports.updateConfig = updateConfig;
