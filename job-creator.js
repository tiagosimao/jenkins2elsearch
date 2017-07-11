module.exports.newRepoSync = newRepoSync;
module.exports.newCommitSync = newCommitSync;

// REPOS
function newRepoSync(mondego,cursor,changedSince) {
  return {
    "name": "List repositories",
    "cursor": cursor,
    "fire": (driver)=>{
      if(driver.module.getRepos){
        return driver.module.getRepos(cursor,changedSince);
      } else {
        return Promise.resolve();
      }
    },
    "accept": (driver, driverResult)=>{
      if(driverResult && driverResult.data){
        const nextCursor = driverResult.cursor;
        const data = driverResult.data;
        console.log("Accepting " + (data.length ? data.length : 1) + " repositories from the driver '" + driver.id + "'")
        acceptRepos(mondego,data,nextCursor != cursor ? nextCursor : undefined);
      }
    }
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
  return {
    "name": "List commits",
    "cursor": cursor,
    "fire": (driver)=>{
      if(driver.module.getCommits){
        return driver.module.getCommits(cursor,repo);
      } else {
        return Promise.resolve();
      }
    },
    "accept": (driver, driverResult)=>{
      if(driverResult && driverResult.data){
        const nextCursor = driverResult.cursor;
        const data = driverResult.data;
        console.log("Accepting " + (data.length ? data.length : 1) + " commits from the driver '" + driver.id + "'")
        acceptCommits(mondego,data,nextCursor != cursor ? nextCursor : undefined,repo);
      }
    }
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
