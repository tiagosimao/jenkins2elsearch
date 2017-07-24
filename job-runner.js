module.exports.run = run;

const methodMapping = {
  "write": [undefined, "write", undefined],
  "syncRepo": ["repo", "getRepos", "syncCommit"],
  "syncCommit": ["commit", "getCommits", undefined],
  "syncPipeline": ["pipeline", "getPipelines", undefined],
};

function run(driver, job){
  return new Promise((ff,rj)=>{
    const mapping = methodMapping[job.method];
    if(driver && job && mapping) {
      runJob(driver, job, mapping[0], mapping[1], mapping[2]).then(
        ok=>ff(ok),
        ko=>rj(ko)
      );
    } else {
      if(!driver){
        rj("Cannot run job: no driver specified");
      } else if(!job){
        rj("Cannot run undefined job");
      } else {
        rj("Cannot run job. No mapping for method " + JSON.stringify(job));
      }
    }
  });
}

function runJob(driver, job, type, driverMethod, cascadeMethod){
  return new Promise((ff,rj)=>{
    //console.log("Running job " + job.method + " on driver " + driver.id)
    const nextJobs = {
      "onDriver":[],
      "onDestination":[]
    };
    if(driver.module[driverMethod]){
      //console.log("Calling " + driverMethod + " on driver " + driver.id);
      driver.module[driverMethod](job.cursor,job.input).then(
        got=>{
          if(got){
            if(got.cursor && got.cursor!=job.cursor){
              const nextPage = Object.assign({},job);
              nextPage.cursor=got.cursor;
              nextJobs.onDriver.push(nextPage);
            }
            if(got.data){
              got.data.forEach(o=>{
                o.type=type;
                nextJobs.onDestination.push({
                  "method": "write",
                  "input": o
                });
                if(cascadeMethod){
                  nextJobs.onDriver.push({
                    "method": cascadeMethod,
                    "input": o
                  });
                }
              });
            }
          }
          ff(nextJobs);
        },
        err=>rj(err)
      );
    } else {
      //console.info("Driver " + driver.id + " doesn't implement the method " + driverMethod + "... ignoring.");
      ff(nextJobs);
    }
  });
}
