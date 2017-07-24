const request = require('request');
const url = require('url');
const linkParser = require('http-link-header');

module.exports.setup = function(settings){
  return new Promise((ff,rj)=>{
    setup(settings,ff,rj);
  });
};
module.exports.getRepos = function(cursor,input){
  return new Promise((ff,rj)=>{
    getNextRepos(cursor,input,ff,rj);
  });
};
module.exports.getCommits = function(cursor,input){
  return new Promise((ff,rj)=>{
    getNextCommits(cursor,input,ff,rj);
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
        rj("Gitlab: setup error: " + error);
      }
    }
  );
}

function get(start,cursor,input,mapper,ff,rj) {
  let url = cursor?cursor:apiBase+start;
  let options = {
    url: url,
    headers: {
      'PRIVATE-TOKEN': private_token
    },
    timeout: 10000
  };
  //console.info("Calling Gitlab: " + options.url);
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
        ff(mapper(got,next ? next.uri : undefined));
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

function getNextRepos(cursor,input,ff,rj) {
  get(
    "projects?archived=true&order_by=last_activity_at&sort=asc&statistics=true",
    cursor,
    input,
    (got,cursor)=>{
      return {
        "data": transformRepos(got).filter(repo=>{
          return !input || repo.activity_timestamp>=input;
        }),
        "cursor": cursor
      };
    },
    ff,
    rj);
}

function transformRepos(gitLabRepos) {
  const result = [];
  for(let project of gitLabRepos) {
    let data = {
      "source_id": project.id,
      "source": "gitlab",
      "repoName": project.name,
      "repoUrl": project.ssh_url_to_repo,
      "description": project.description,
      "archived": project.archived,
      "created_timestamp": project.created_at,
      "activity_timestamp": project.last_activity_at,
      "size": project.statistics ? project.statistics.storage_size : undefined
    };
    result.push(data);
  }
  return result;
}

function getNextCommits(cursor,repo,ff,rj) {
  get(
    "projects/"+repo.source_id+"/repository/commits",
    cursor,
    repo,
    (commitList,cursor)=>{
      return {
      "data": transformCommits(repo,commitList),
      "cursor": cursor
      }
    },
    ff,
    rj);
}

function transformCommits(repo,gitLabCommits) {
  const result = [];
  for(let commit of gitLabCommits) {
    let data = {
      "source_id": commit.id,
      "source": "gitlab",
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
