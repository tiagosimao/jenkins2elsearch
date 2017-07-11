const request = require('request');
const url = require('url');
const linkParser = require('http-link-header');

module.exports.setup = function(settings){
  return new Promise((ff,rj)=>{
    setup(settings,ff,rj);
  });
};
module.exports.getRepos = function(fromCursor,changedSince){
  return new Promise((ff,rj)=>{
    getNextRepos(fromCursor,ff,rj);
  });
};
module.exports.getCommits = function(fromCursor,repo){
  return new Promise((ff,rj)=>{
    getNextCommits(repo,fromCursor,ff,rj);
  });
};

let apiBase;
let private_token;

function setup(settings,ff,rj) {
  if(!settings.url) {
    return rj("No URL set for GitLab");
  }
  apiBase = settings.url;
  if(!apiBase.endsWith("/")){
    apiBase += "/";
  }
  apiBase+="api/v4/";
  request.post(
    apiBase + "session?login="+settings.username+"&password=" + settings.password,
    function (error, response, body) {
      if (!error && response.statusCode < 300) {
        let got = JSON.parse(body);
        private_token = got.private_token;
        if(private_token) {
          ff("GitLab authentication complete");
        } else {
          rj("Gitlab: Invalid authentication response");
        }
      } else {
        rj("Gitlab: setup error: " + response.statusCode);
      }
    }
  );
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

function getNextRepos(from,ff,rj) {
  get(
    "projects?archived=true&order_by=last_activity_at&sort=asc&statistics=true",
    from,
    transformRepos,
    ff,
    rj);
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

function getNextCommits(repo,from,ff,rj) {
  get(
    "projects/"+repo.id+"/repository/commits",
    from,
    (commitList)=>transformCommits(repo,commitList),
    ff,
    rj);
}

function transformCommits(repo,gitLabCommits) {
  const result = [];
  for(let commit of gitLabCommits) {
    let data = {
      "id": repo.repoName + "-" + commit.id,
      "repoName": repo.repoName,
      "repoUrl": repo.repoUrl,
      "user": commit.author_email,
      "description": commit.message,
      "created_timestamp": commit.commited_date ? commit.commited_date : commit.created_at
    };
    result.push(data);
  }
  return result;
}
