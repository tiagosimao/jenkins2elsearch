const fs = require('fs');
const http = require('https');
const url = require('url');
const request = require('request');
const elasticsearch = require('elasticsearch');
const events = require('events');
const bus = new events.EventEmitter();

const moduleReadyEvent = "moduleReadyEvent";

let writerReady = false;
let queuedReaders = [];

let config;
let elclient;

// HTTP TOOLS
function getJson(protocol, host, path, user, pass, reader) {
    var options = {
        protocol: protocol,
        hostname: host,
        path: path,
        auth: user + ":" + pass
    }
    console.log("GET: " + path);

    http.get(options, function(res) {
        res.setEncoding('utf8');
        var rawData = '';
        if(res.statusCode!=200) {
            console.log("Error fetching " + path + " (" + res.statusCode + ")");
            return;
        }
        console.log("GOT: " + res.statusCode + " from " + path);
        res.on('data', function(chunk) {rawData += chunk;});
        res.on('end', function() {
            var data = JSON.parse(rawData);
            reader(data);
        });
    });
}

// QUEUE
function queue(reader) {
    queuedReaders.push(reader);
    bus.emit(moduleReadyEvent);
}

// READERS
function sync() {
    if(writerReady) {
        let reader;
        while(reader=queuedReaders.pop()) {
            reader();
        }
    }
}

function syncBuilds(job,onSync) {
    for (var i in job.builds) {
        var build = job.builds[i];
        var buildUrl = url.parse(build.url);
        console.log("Found build " + build.number + " at " + build.url);
        getJson(buildUrl.protocol, buildUrl.host, buildUrl.path + "api/json",
            config.jenkins.username, config.jenkins.password,
            function (jenkinsBuildData) {
                let culprit;
                if(jenkinsBuildData.culprits && jenkinsBuildData.culprits.length > 0){
                    culprit = jenkinsBuildData.culprits[0].fullName;
                }
                let buildData = {
                    "id": jenkinsBuildData.id,
                    "project": job.name,
                    "duration": jenkinsBuildData.duration,
                    "timestamp": new Date(jenkinsBuildData.timestamp).toISOString(),
                    "status": jenkinsBuildData.result,
                    "cause": jenkinsBuildData.description,
                    "url": jenkinsBuildData.url,
                    "user": culprit
                };
                write(config.elasticsearch.buildindex, job.name, buildData.id + "", buildData)
        });
    }
    onSync();
}


function syncJenkinsJobs(jobs) {
    if (jobs) {
        var job = jobs.shift();
        if (job) {
            //setTimestampMapping(config.elasticsearch.buildindex, job.name, "timestamp");
            var jobUrl = url.parse(job.url);
            console.log("Found job " + job.name + " at " + job.url);
            getJson(jobUrl.protocol, jobUrl.host, jobUrl.path + "api/json",
                config.jenkins.username, config.jenkins.password,
                function (data) {
                    syncBuilds(data, function () {
                        syncJenkinsJobs(jobs);
                    });
                });
        }
    } else {
        console.log("Taking our jobs");
        getJson(config.jenkins.protocol, config.jenkins.host, config.jenkins.path + "/api/json",
            config.jenkins.username, config.jenkins.password,
            function (data) {
                syncJenkinsJobs(data.jobs);
            });
    }
}

function syncGitlabProject(project) {

}

function syncGitlabProjects() {
    var options = {
        url: config.gitlab.url + "/projects/",
        headers: {
            'PRIVATE-TOKEN': config.gitlab.private_token
        }
    };
    request(options, function(error, response, body){
        if(response.statusCode<300){
            let got = JSON.parse(body);
            syncGitlabProject(got);
        } else {
            console.log("Error getting projects from Gitlab: " + response.statusCode)
        }
    });
}

// WRITE DATA

function write(index, type, id, data) {
    console.log("trying to write");
    elclient.index({
        index: index,
        type: type,
        id: id,
        body: data
    });
}

/*function setTimestampMapping(index,type,property){
    var body = {};
    body[type]= {
        properties:{}
    };
    body[type].properties[property]={"type" : "date"};
    elclient.indices.putMapping({index:index, type:type, body:body});
}*/


// SETUP MODULES

function setup() {
    setupJenkins();
    setupGitlab();
    setupElasticsearch();
}

function setupElasticsearch() {
    elclient = new elasticsearch.Client({
        host: config.elasticsearch.url,
        log: 'info'
    });
    elclient.ping({
        requestTimeout: 1000
    }, function (error) {
        if (error) {
            console.error("Error connecting to Elasticsearch");
        } else {
            writerReady=true;
            bus.emit(moduleReadyEvent);
        }
    });
}

function setupJenkins() {
    let jurl = url.parse(config.jenkins.url);
    if(jurl){
        config.jenkins.protocol=jurl.protocol;
        config.jenkins.host=jurl.host;
        config.jenkins.path=jurl.path;
    }
    queue(syncJenkinsJobs);
}

function setupGitlab() {
    request.post(
        config.gitlab.url + "/session?login="+config.gitlab.username+"&password=" + config.gitlab.password,
        function (error, response, body) {
            if (!error && response.statusCode < 300) {
                let got = JSON.parse(body);
                config.gitlab.private_token = got.private_token;
                if(config.gitlab.private_token) {
                    console.log("Gitlab: Authenticated");
                    queue(syncGitlabProjects);
                } else {
                    console.log("Gitlab: Invalid authentication response");
                }
            } else {
                console.log("Gitlab: setup error: " + response.statusCode);
            }
        }
    );
}

// BOOTSTRAP
function loadConfig(configLocation) {
    config = JSON.parse(fs.readFileSync(configLocation, encoding="utf-8"));
}

function boot() {
    let configLocation = process.argv[2];
    if(!configLocation) {
        console.log("usage: node mondego.js <config file location>")
    } else {
        loadConfig(configLocation);
        bus.on(moduleReadyEvent,()=>{
            sync();
        });
        setup();

    }
}
boot();