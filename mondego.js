console.log("usage: node mondego.js <user> <pass>")

const http = require('https');
const url = require('url');
const elasticsearch = require('elasticsearch');

//var parser = new xml2js.Parser();
var elclient = new elasticsearch.Client({
    host: 'localhost:9200',
    log: 'debug'
});

var elindex = "projects";
var jenkinsProtocol = "https:";
var jenkinsHost = "ci.impresa.pt";

function getJson(protocol, host, path, reader) {
    var options = {
        protocol: protocol,
        hostname: host,
        path: path,
        auth: process.argv[2] + ":" + process.argv[3]
    }
    console.log("GET: " + path);

    http.get(options, function(res) {
        res.setEncoding('utf8');
        var rawData = '';
        if(res.statusCode!=200) {
            console.log("Error fetching " + path);
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

function syncBuilds(job,onSync) {
    for (var i in job.builds) {
        var build = job.builds[i];
        var buildUrl = url.parse(build.url);
        console.log("Found build " + build.number + " at " + build.url);
        getJson(buildUrl.protocol, buildUrl.host, buildUrl.path + "api/json", function (buildData) {
            submit(job.name + "", buildData.id + "", buildData);
        });
    }
    onSync();
}


function syncJobs(jobs) {
    if(!jobs) {
        console.log("Taking our jobs");
        getJson(jenkinsProtocol, jenkinsHost, "/jenkins/api/json", function (data) {
            syncJobs(data.jobs);
        });
    } else {
        var job = jobs.shift();
        if(job) {
            setMappings(elindex,job.name);
            var jobUrl = url.parse(job.url);
            console.log("Found job " + job.name + " at " + job.url);
            getJson(jobUrl.protocol, jobUrl.host, jobUrl.path + "api/json", function (data) {
                syncBuilds(data,function(){syncJobs(jobs);});
            });
        }
    }
}


function submit(jobName, buildNumber, data) {
    data.jobName=jobName;
    elclient.index({
        index: elindex,
        type: jobName,
        id: buildNumber,
        body: data
    });
}

syncJobs();


function setMappings(idx,t){
    var body = {};
    body[t]= {
        properties:{
            timestamp: {"type" : "date"}
        }
    };
    elclient.indices.putMapping({index:idx, type:t, body:body});
}

