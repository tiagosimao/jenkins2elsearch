const fs = require('fs');
const http = require('https');
const url = require('url');
const request = require('request');
const elasticsearch = require('elasticsearch');
const events = require('events');
const bus = new events.EventEmitter();

const moduleReadyEvent = "moduleReadyEvent";
const jenkinsReadyEvent = "jenkinsReadyEvent";

let writerReady = false;
let queuedReaders = [];

let config;
let elclient;


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


// JENKINS
let jenkinsQueue = [];
let jenkinsErrored = [];

function readJenkinsQueue() {
    let call;
    let timeout = 100;
    if(call=jenkinsQueue.pop()) {
        call(call);
    }
    if(jenkinsErrored.length>0){
        timeout=Math.min(100,Math.min(10000,jenkinsErrored.length*100));
        jenkinsQueue.push(jenkinsErrored.pop());
    }
    setTimeout(readJenkinsQueue,timeout);
}

function jenkinsGet(path, reader) {
    jenkinsQueue.push((myself)=>{
        let callUri = url.resolve(config.jenkins.url,path);
        console.info("Calling Jenkins: " + path);
        request(url.format(callUri), (error,response,body)=>{
            if(error){
                console.error("Error getting data from Jenkins: " + callUri.path);
                console.error(error);
                if(!response||response.statusCode>499){
                    jenkinsErrored.push(myself);
                }
            } else if(response && response.statusCode < 300) {
                let data = JSON.parse(body);
                reader(data);
                return;
            } else {
                let cause = response ? response.statusCode : "unknown cause";
                console.error("Error getting data from Jenkins: " + cause + " at " + path);
            }
        });
    });
}

function syncPromotion(promotion,process,job,buildId) {
    var promotionUrl = url.parse(promotion.url);
    jenkinsGet(promotionUrl.path + "api/json",
        got=>{
            let promotionData = {
                "id": got.id,
                "repoName": job.name,
                "duration": got.duration,
                "created_timestamp": new Date(got.timestamp).toISOString(),
                "status": got.result,
                "description": got.description,
                "url": got.url
            };
            write(config.elasticsearch.index, "release", promotionData.id + "", promotionData);
        }
    );
}

function syncProcess(process,job,buildId) {
    var processUrl = url.parse(process.url);
    jenkinsGet(processUrl.path + "api/json",
        got=>{
            for(let promotion of got.builds){
                syncPromotion(promotion,process,job,buildId);
            }
        }
    );
}

function syncPromotions(job,buildId) {
    var jobUrl = url.parse(job.url);
    jenkinsGet(jobUrl.path + "promotion/api/json",
        got=>{
            for(let process of got.processes){
                syncProcess(process,job,buildId);
            }
        }
    );
}

function syncBuilds(job,onSync) {
    for (var i in job.builds) {
        var build = job.builds[i];
        var buildUrl = url.parse(build.url);
        jenkinsGet(buildUrl.path + "api/json",
            function (jenkinsBuildData) {
                let culprit;
                if(jenkinsBuildData.culprits && jenkinsBuildData.culprits.length > 0){
                    culprit = jenkinsBuildData.culprits[0].fullName;
                }
                let buildData = {
                    "id": jenkinsBuildData.id,
                    "repoName": job.name,
                    "duration": jenkinsBuildData.duration,
                    "created_timestamp": new Date(jenkinsBuildData.timestamp).toISOString(),
                    "status": jenkinsBuildData.result,
                    "description": jenkinsBuildData.description,
                    "url": jenkinsBuildData.url,
                    "user": culprit
                };
                write(config.elasticsearch.index, "build", buildData.id, buildData);
                syncPromotions(job,jenkinsBuildData.id);
        });
    }
    onSync();
}

function syncJenkinsJobs(jobs) {
    if (jobs) {
        var job = jobs.shift();
        if (job) {
            var jobUrl = url.parse(job.url);
            jenkinsGet(jobUrl.path + "api/json",
                function (data) {
                    syncBuilds(data, function () {
                        syncJenkinsJobs(jobs);
                    });
                });
        }
    } else {
        jenkinsGet("api/json",
            function (data) {
                syncJenkinsJobs(data.jobs);
            });
    }
}


// GITLAB
function gitlabGet(apiPath, reader, pageIndex, pageSize) {
    apiPath = apiPath.replace(/^\/|\/$/,'');
    let path = url.parse(config.gitlab.url+apiPath);
    if(pageIndex || pageIndex==0) {
        let search = path.search;
        if(search){
            search+="&";
        } else {
            search="?";
        }
        search+="page=" + pageIndex
        if(!pageSize){
            pageSize = 20;
        }
        search+="per_page=" + pageSize;
        path.search = search;
    }
    let options = {
        url: url.format(path),
        headers: {
            'PRIVATE-TOKEN': config.gitlab.private_token
        }
    };
    console.info("Calling Gitlab: " + options.url);
    request(options, function (error, response, body) {
        if(error) {
            console.error("Error getting data from Gitlab: " + error)
        }  else if (response && response.statusCode < 300) {
            let got = JSON.parse(body);
            if(got && Object.keys(got).length > 0) {
                reader(got);
                let nextPageIndex = response.headers["x-next-page"];
                if (!nextPageIndex) {
                    nextPageIndex = pageIndex ? (pageIndex + 1) : 1;
                }
                let suggestedPageSize = response.headers["x-per-page"];
                if (suggestedPageSize) {
                    pageSize = suggestedPageSize;
                }
                gitlabGet(apiPath, reader, nextPageIndex, pageSize);
            }
        } else {
            let cause = response ? response.satusCode : "unknown cause";
            console.error("Error getting data from Gitlab: " + options.url  + " (" + cause + ")")
        }
    });
}

function syncGitlabCommits(project) {
    gitlabGet("/projects/" + project.id + "/repository/commits",commits=>{
        for(let commit of commits) {
            let data = {
                "uid": commit.id,
                "repoName": project.name,
                "user": commit.author_email,
                "description": commit.title,
                "created_timestamp": commit.created_at
            };
            write(config.elasticsearch.index,"commit",commit.uid,data);
        }
    }, 0);
}

function syncGitlabProjects() {
    gitlabGet("/projects/",projects=>{
        for(let project of projects) {
            let data = {
                "id": project.id,
                "repoName": project.name,
                "description": project.description,
                "archived": project.archived,
                "created_timestamp": project.created_at,
                "activity_timestamp": project.last_activity_at
            };
            write(config.elasticsearch.index,"repo",project.id,data);
            syncGitlabCommits(project);
        }
    });
}

// WRITE DATA

function write(index, type, id, data) {
    elclient.index({
        index: index,
        type: type,
        id: id,
        body: data
    });
}

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
    if(!config.jenkins.url.endsWith('/')){
        config.jenkins.url+='/';
    }
    readJenkinsQueue();
    queue(syncJenkinsJobs);
}

function setupGitlab() {
    if(!config.gitlab.url) {
        console.error("No URL set for GitLab");
    }
    if(!config.gitlab.url.endsWith("/")){
        config.gitlab.url += "/";
    }
    request.post(
        config.gitlab.url + "/session?login="+config.gitlab.username+"&password=" + config.gitlab.password,
        function (error, response, body) {
            if (!error && response.statusCode < 300) {
                let got = JSON.parse(body);
                config.gitlab.private_token = got.private_token;
                if(config.gitlab.private_token) {
                    queue(syncGitlabProjects);
                } else {
                    console.error("Gitlab: Invalid authentication response");
                }
            } else {
                console.error("Gitlab: setup error: " + response.statusCode);
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
        console.error("usage: node mondego.js <config file location>")
    } else {
        loadConfig(configLocation);
        bus.on(moduleReadyEvent,()=>{
            sync();
        });
        setup();

    }
}
boot();