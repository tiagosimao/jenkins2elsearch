module.exports.newRepoSync = newRepoSync;
module.exports.newCommitSync = newCommitSync;
module.exports.newPipelineSync = newPipelineSync;

// COMMON

function createFire(methodName, cursor, input) {
  return (driver)=>{
    if(driver.module[methodName]){
      console.log("Firing job " + methodName + " on driver " + driver.id);
      return driver.module[methodName](cursor,input);
    } else {
      return Promise.resolve();
    }
  };
}

function createAccept(mondego, typeName, acceptFunction, cursor, input) {
  return (driver, driverResult)=>{
    if(driverResult && driverResult.data){
      const nextCursor = driverResult.cursor;
      const data = driverResult.data;
      console.log("Accepting " + (data.length ? data.length : 1) + " " + typeName + " from the driver '" + driver.id + "'")
      acceptFunction(mondego,data,nextCursor != cursor ? nextCursor : undefined, input);
    }
  };
}

// REPOS
function newRepoSync(mondego,cursor,changedSince) {
  return {
    "name": "List repositories",
    "fire": createFire("getRepos", cursor, changedSince),
    "accept": createAccept(mondego,"repositories",acceptRepos, cursor, changedSince)
  };
}

function acceptRepos(mondego,repos,cursor){
  for(let i=0;i<repos.length;++i){
    const repo = repos[i];
    mondego.write("repo", repo);
    mondego.queue(newCommitSync(mondego,undefined,repo));
  }
  if(cursor){
    mondego.queue(newRepoSync(mondego,cursor,undefined));
  }
}

// COMMITS
function newCommitSync(mondego,cursor,repo) {
  if(!repo){
    console.trace("Invalid commit sync request: no repo defined for cursor " + cursor);
    return;
  }
  return {
    "name": "List commits",
    "fire": createFire("getCommits", cursor, repo),
    "accept": createAccept(mondego,"commits", acceptCommits, cursor, repo)
  };
}

function acceptCommits(mondego,commits,cursor,repo){
  for(let i=0;i<commits.length;++i){
    const commit = commits[i];
    mondego.write("commit", commit);
  }
  if(cursor){
    mondego.queue(newCommitSync(mondego,cursor,repo));
  }
}

// PIPELINES
function newPipelineSync(mondego,cursor,changedSince) {
  return {
    "name": "List pipelines",
    "fire": createFire("getPipelines", cursor, changedSince),
    "accept": createAccept(mondego,"pipelines", acceptPipelines, cursor, changedSince)
  };
}

function acceptPipelines(mondego,pipelines,cursor,input){
  for(let i=0;i<pipelines.length;++i){
    const pipeline = pipelines[i];
    mondego.write("pipeline", pipeline);
    //mondego.queue(newBuildSync(mondego,undefined,pipeline));
  }
  if(cursor){
    mondego.queue(newPipelineSync(mondego,cursor,input));
  }
}
