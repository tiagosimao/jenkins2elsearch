const request = require('request');
const url = require('url');
const linkParser = require('http-link-header');

module.exports.setup = function(settings){
  return new Promise((ff,rj)=>{
    setup(settings,ff,rj);
  });
};
module.exports.get = function(start, cursor, mapper, ff, rj){
  get(start, cursor, mapper, ff,rj);
};

let jenkinsBaseUrl;

function setup(settings,ff,rj) {
  if(!settings.url) {
    return rj("No URL set for Jenkins");
  }
  jenkinsBaseUrl=settings.url.endsWith('/')?settings.url:(settings.url+"/");
}

function get(path, reader) {
  https://ci.impresa.pt/jenkins/api/json?tree=jobs[url]
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

function get(start,cursor,mapper,ff,rj) {
  let url = cursor?cursor:apiBase+start;
  let options = {
    url: url,
    headers: {
      'PRIVATE-TOKEN': private_token
    },
    timeout: 10000
  };
  console.info("Calling Gitlab: " + options.url);
  request(options, function (error, response, body) {
    if(error) {
      rj("Error getting data from Gitlab: " + error)
    } else if (response && response.statusCode < 300) {
      let got = JSON.parse(body);
      if(got && Object.keys(got).length > 0) {
        const lh = response.headers["link"];
        let next;
        if(lh){
          let link = linkParser.parse(lh);
          next = link.get( 'rel', 'next' );
          next = (next && next.length>0) ? next[0] : undefined;
        }
        ff({
          data: mapper(got),
          cursor: next ? next.uri : undefined
        });
      } else {
        ff({
          data: [],
          cursor: undefined
        });
      }
    } else {
      let cause = response ? response.statusCode : "unknown cause";
      rj("Error getting data from Gitlab: " + options.url  + " (" + cause + ")")
    }
  });
}

function transformRepos(gitLabRepos) {
  const result = [];
  for(let project of gitLabRepos) {
    let data = {
      "id": project.id,
      "repoName": project.name,
      "repoUrl": project.ssh_url_to_repo,
      "description": project.description,
      "archived": project.archived,
      "created_timestamp": project.created_at,
      "activity_timestamp": project.last_activity_at,
      "size": project.statistics.storage_size
    };
    result.push(data);
  }
  return result;
}

function transformCommits(repo,gitLabCommits) {
  const result = [];
  for(let commit of gitLabCommits) {
    let data = {
      "id": commit.id,
      "repoName": repo.repoName,
      "repoUrl": repo.repoUrl,
      "user": commit.author_email,
      "description": commit.message,
      "created_timestamp": commit.commited_date
    };
    result.push(data);
  }
  return result;
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
