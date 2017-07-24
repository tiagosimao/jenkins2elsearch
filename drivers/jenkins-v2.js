module.exports.setup = function(settings){
  return new Promise((ff,rj)=>{
    setup(settings,ff,rj);
  });
};
module.exports.getPipelines = (fromCursor, changedSince)=>{
  return getPipelines(fromCursor, changedSince);
}
module.exports.getBuilds = (fromCursor, pipeline)=>{
  return getBuilds(fromCursor, pipeline);
}

const request = require('request');
const XML = require('xml2js');

let jenkinsBaseUrl;

function setup(settings,ff,rj) {
  if(!settings.url) {
    return rj("No URL set for Jenkins");
  }
  jenkinsBaseUrl=settings.url.endsWith('/')?settings.url:(settings.url+"/");
  ff();
}

function get(endpoint,reader) {
  return new Promise((ff,rj)=>{
    request(endpoint, (error,response,body)=>{
      if(error) {
        rj("Error getting data from Jenkins: " + error)
      } else if (response && response.statusCode < 300) {
        ff(body);
      } else {
        let cause = response ? response.statusCode : "unknown cause";
        rj("Error getting data from Jenkins: " + endpoint  + " (" + cause + ")")
      }
    });
  });
}


// getBuilds
// url/job/<JOB NAME>/api/json?tree=builds[id,url,duration,timestamp,number,result]
// url/job/<JOB NAME>/api/json?tree=allBuilds[id,url,duration,timestamp,number,result]

function getBuilds(cursor, pipeline) {
  return new Promise((ff,rj)=>{
    get(jenkinsBaseUrl+'job/' + pipeline.source_id + '/api/json?tree=allBuilds[id,url,duration,timestamp,number,result]').then(
      body=>{
        buildsReader(pipeline,body).then(
          builds=>{
            ff({
              data: builds,
              cursor: undefined
            });
          },
          error=>{
            rj(error);
          }
        );
      },
      error=>{
        rj(error);
      }
    );
  });
}

// getBuild: steps, artifacts, culprits ...
// url/job/<JOB NAME>/<JOB NUMBER>/api/json?tree=id,result,timestamp,url,culprits[id],description,displayName,duration,fullDisplayName
function buildsReader(pipeline,body){
  return new Promise((ff,rj)=>{
    try{
      const json = JSON.parse(body);
      const allP = [];
      for(let i=0;i<json.allBuilds.length;++i){
        const build = json.allBuilds[i];
        const apiPromise = get(jenkinsBaseUrl+'job/' + pipeline.source_id +'/' + build.number + '/api/json?tree=id,result,timestamp,url,culprits[id],description,displayName,duration,fullDisplayName');
        allP.push(apiPromise);
        apiPromise.then(
          body=>{
            const json = JSON.parse(body);
            Object.assign(build,json);
          },
          ko=>{
            rj(ko);
          }
        );
      }
      Promise.all(allP).then(
        ok=>ff(toBuilds(pipeline, json.allBuilds)),
        ko=>rj(ko)
      );
    } catch(e) {
      rj(e);
    }
  });
}

function toBuilds(pipeline,builds){
  return builds.map(build=>{
    return {
      "source_id": pipeline.source_id + '-' + build.id,
      "source": "jenkins",
      "name": build.fullDisplayName ? build.fullDisplayName : build.name,
      "description" : build.description,
      "number": build.number,
      "duration": build.duration,
      "status": build.result,
      "created_timestamp": build.timestamp,
      "url": build.url
    };
  });
}

// getPipelines
// url/api/json?tree=jobs[url]

// getPipeline
// url/job/<JOB NAME>/api/json?tree=name,description,url
// url/job/<JOB NAME>/config.xml

function getPipelines(cursor, changedSince) {
  return new Promise((ff, rj)=>{
    get(jenkinsBaseUrl+'api/json?tree=jobs[name,description,url]').then(
      body=>{
        pipelinesReader(body).then(
          pipelines=>{
            ff({
              data: pipelines,
              cursor: undefined
            });
          },
          error=>{
            rj(error);
          }
        );
      },
      error=>{
        rj(error);
      }
    );
  });
}

function pipelinesReader(body){
  return new Promise((ff,rj)=>{
    try{
      const json = JSON.parse(body);
      const allP = [];
      for(let i=0;i<json.jobs.length;++i){
        const job = json.jobs[i];
        //console.log("Reading pipeline " + job.name + " from Jenkins")
        // fetch data from config.xml
        const configPromise = get(jenkinsBaseUrl+'job/'+job.name+'/config.xml');
        allP.push(configPromise);
        configPromise.then(
          body=>{
            pipelineConfigReader(job,body).then(
              ok=>{},
              ko=>console.log(ko)
            );
          },
          ko=>console.log(ko)
        );
        // fetch data from json api
        const apiPromise = get(jenkinsBaseUrl+'job/'+job.name+'/api/json?tree=firstBuild[timestamp]');
        allP.push(apiPromise);
        apiPromise.then(
          body=>{
            pipelineApiReader(job,body).then(
              ok=>{},
              ko=>console.log(ko)
            );
          },
          ko=>console.log(ko)
        );
      }
      Promise.all(allP).then(
        ok=>ff(jobsToPipelines(json.jobs)),
        ko=>rj(ko)
      );
    } catch(e) {
      rj(e);
    }
  });
}

function jobsToPipelines(jobs){
  return jobs.map(job=>{
    return {
      "source_id": job.name,
      "source": "jenkins",
      "name": job.name,
      "description": job.description,
      "created_timestamp": job.created_timestamp,
      "repoUrl": job.repoUrl
    };
  });
}

function pipelineConfigReader(job,body){
  return new Promise((ff,rj)=>{
    XML.parseString(body, (err,result)=>{
      if(err){
        console.error("Error reading pipeline: " + err);
        rj(err);
      } else{
        job.repoUrl=findRepoUrl(result);
        ff();
      }
    });
  });
}

function pipelineApiReader(job,body){
  return new Promise((ff,rj)=>{
    const json = JSON.parse(body);
    let when;
    if(json&&json.firstBuild){
      when = json.firstBuild.timestamp;
    }
    job.created_timestamp=when?when:Date.now();
    ff();
  });
}


function findRepoUrl(config,key){
  let urls = [];
  const scm = findObject(config,"scm");
  if(scm){
    urls = urls.concat(findValue(scm,"url"));
    urls = urls.concat(findValue(scm,"remote"));
  }
  if(urls.length>1){
    urls = urls.filter(candidate=>{
      return candidate && candidate.trim();
    });
    if(urls&&urls.length>0){
      const weighted = urls.map(candidate=>{
        return {
          url: candidate,
          weight: candidate.match(/^git/) ? 3 : (candidate.match(/^https/) ? 2 : 1)
        };
      });
      const max = weighted.reduce((max,current)=>{
        return max ? (current.weight>max.weight ? current : max) : current;
      });
      urls = (max && max.url) ? [max.url] : [];
    }
  }
  return urls.length==0?undefined:urls[0];
}

function findObject(json,key){
  if(typeof json == 'object'){
    const ks = Object.keys(json);
    for(let i=0;i<ks.length;++i){
      const value = json[ks[i]];
      if(key==ks[i] && value){
        return value;
      }
      else {
        const deepFind = findObject(value,key)
        if(deepFind){
          return deepFind;
        }
      }
    }
  }
}

function findValue(json,key){
  let result = [];
  if(typeof json == 'object'){
    const ks = Object.keys(json);
    for(let i=0;i<ks.length;++i){
      const value = json[ks[i]];
      let computed;
      if(key==ks[i]){
        computed = value;
        if(!computed.filter){
          computed = [computed];
        }
        computed = computed.filter(o=>{
          return typeof o == 'string' || typeof o == 'number';
        });
      }
      if(typeof computed == 'object'){
        result = result.concat(value);
      } else {
        const deepFind = findValue(value,key)
        if(deepFind){
          result = result.concat(deepFind);
        }
      }
    }
  }
  return result;
}
