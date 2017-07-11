const configLoader = require('./config-loader');
const driverBooter = require('./driver-booter');
const dataSyncer = require('./data-syncer');

const http = require('https');

const events = require('events');
let path = require("object-path");

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
let jenkinsWait = 100;
let jenkinsMaxWait = 60000;
let jenkinsCurrentWait = 0;

function readJenkinsQueue() {
    let call;
    if(call=jenkinsQueue.pop()) {
        call(()=>{
            jenkinsWait=Math.min(10000,jenkinsWait+100);
            setTimeout(readJenkinsQueue,jenkinsWait);
        },()=>{
            jenkinsWait=Math.max(jenkinsWait-100,0);
            setTimeout(readJenkinsQueue,jenkinsWait);
        });
    } else if(jenkinsCurrentWait<jenkinsMaxWait) {
        jenkinsCurrentWait+=100;
        setTimeout(readJenkinsQueue,100); // poll interval
    }
}

function jenkinsGet(path, reader) {
    jenkinsQueue.push((retry,next)=>{
        let callUri = url.resolve(config.jenkins.url,path);
        console.info("Calling Jenkins: " + path);
        request(url.format(callUri), (error,response,body)=>{
            try{
                if(error) {
                    console.error("Error getting data from Jenkins: " + callUri.path);
                    console.error(error);
                } else if(response && response.statusCode < 300) {
                    let data = JSON.parse(body);
                    reader(data);
                } else {
                    let cause = response ? response.statusCode : "unknown cause";
                    console.error("Error getting data from Jenkins: " + cause + " at " + path);
                }
            } finally {
                if(error || response && response.statusCode>499){
                    retry();
                } else {
                    next();
                }
            }
        });
    });
}

function findCulprit(data) {
    return path.coalesce(data,[
        ["culprits",0,"fullName"],
        ["actions", 0, "causes", 0, "userName"],
        ["actions", 1, "causes", 0, "userName"],
        ["actions", 2, "causes", 0, "userName"],
        ["actions", 3, "causes", 0, "userName"],
        ["actions", 4, "causes", 0, "userName"],
        ["actions", 5, "causes", 0, "userName"],
        ["actions", 6, "causes", 0, "userName"],
        ["actions", 7, "causes", 0, "userName"],
        ["actions", 8, "causes", 0, "userName"],
        ["actions", 9, "causes", 0, "userName"]
    ]);
}

function findRepoUrlInBuild(data) {
    return path.coalesce(data,[
        ["actions",0,"remoteUrls",0],
        ["actions",1,"remoteUrls",0],
        ["actions",2,"remoteUrls",0],
        ["actions",3,"remoteUrls",0],
        ["actions",4,"remoteUrls",0],
        ["actions",5,"remoteUrls",0],
        ["actions",6,"remoteUrls",0],
        ["actions",7,"remoteUrls",0],
        ["actions",8,"remoteUrls",0],
        ["actions",9,"remoteUrls",0],
    ]);
}

function syncPromotion(promotionType,promotion,job) {
    var promotionUrl = url.parse(promotion.url);
    jenkinsGet(promotionUrl.path + "api/json",
        got=>{
            let call = build=>{
                let promotionData = {
                    "uid": got.id,
                    "jobName": job.name,
                    "repoUrl": findRepoUrlInBuild(build),
                    "buildNumber": buildNumber,
                    "promotionType": promotionType,
                    "duration": got.duration ? (got.duration / 1000) : undefined,
                    "created_timestamp": new Date(got.timestamp).toISOString(),
                    "status": got.result,
                    "description": got.description,
                    "url": got.url,
                    "user": findCulprit(got)
                };
                write(config.elasticsearch.index, "release", job.name + "-" + promotionData.uid, promotionData);
            };
            let buildNumber = got.target ? got.target.number : undefined;
            if(buildNumber) {
                jenkinsGet("job/" + job.name + "/" + buildNumber + "/api/json", call);
            } else {
                call();
            }

        }
    );
}

function syncProcess(process,job) {
    var processUrl = url.parse(process.url);
    jenkinsGet(processUrl.path + "api/json",
        got=>{
            for(let promotion of got.builds){
                syncPromotion(process.name, promotion,job);
            }
        }
    );
}

function syncPromotions(job) {
    var jobUrl = url.parse(job.url);
    jenkinsGet(jobUrl.path + "promotion/api/json",
        got=>{
            for(let process of got.processes){
                syncProcess(process,job);
            }
        }
    );
}

function syncBuilds(job) {
    for (var i in job.builds) {
        var build = job.builds[i];
        var buildUrl = url.parse(build.url);
        jenkinsGet(buildUrl.path + "api/json",
            function (jenkinsBuildData) {
                let buildData = {
                    "uid": jenkinsBuildData.id,
                    "repoName": job.name,
                    "repoUrl": findRepoUrlInBuild(jenkinsBuildData),
                    "buildNumber": jenkinsBuildData.number,
                    "duration": jenkinsBuildData.duration ? (jenkinsBuildData.duration / 1000) : undefined,
                    "created_timestamp": new Date(jenkinsBuildData.timestamp).toISOString(),
                    "status": jenkinsBuildData.result,
                    "description": jenkinsBuildData.description,
                    "url": jenkinsBuildData.url,
                    "user": findCulprit(jenkinsBuildData)
                };
                write(config.elasticsearch.index, "build", job.name + "-" + buildData.uid, buildData);
        });
    }
}

function syncJenkinsJobs() {
    jenkinsGet("api/json",
        (rootData) => {
            for(let jobSummary of rootData.jobs){
                var jobUrl = url.parse(jobSummary.url);
                jenkinsGet(jobUrl.path + "api/json",
                    (job) => {
                        syncBuilds(job);
                        syncPromotions(job);
                    });
            }
        });
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
                "repoUrl": project.ssh_url_to_repo,
                "user": commit.author_email,
                "description": commit.title,
                "created_timestamp": commit.created_at
            };
            write(config.elasticsearch.index,"commit",project.name + "-" + data.uid,data);
        }
    }, 0);
}

function syncGitlabProjects() {
    gitlabGet("/projects/",projects=>{
        for(let project of projects) {
            let data = {
                "id": project.id,
                "repoName": project.name,
                "repoUrl": project.ssh_url_to_repo,
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
    console.info("Writing: " + index + "/" + type + "/" + id);
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



// BOOTSTRAP


configLoader.load(process.argv[2])
.then(
  mondego=>{
    console.log("Loaded Mondego");
    driverBooter.boot(mondego).then(
      ok=>{
        console.log("Finish driver boot");
        dataSyncer.sync(mondego).then(
          ok=>console.log("Finished data sync"),
          ko=>console.error("Error syncing data: " + ko)
        )
      },
      ko=>console.log("Error loading modules: " + ko)
    );
  },
  ko=>console.error(ko)
);
