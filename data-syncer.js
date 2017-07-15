const jobCreator = require('./job-creator');

const no_delay = 0;
const long_delay = 1000;

let emptyReportCount = 0;

let state = [
  {
    "constructor": "newRepoSync",
    "cursor": undefined,
    "input": undefined
  },
  {
    "constructor": "newPipelineSync",
    "cursor": undefined,
    "input": undefined
  }
];

module.exports.sync = function(mondego){
    return new Promise((ff,rj)=>{
      report(mondego);
      mondego.forEachDriver(driver=>fireConsumer(driver,no_delay));
      loadState(mondego);
    });
};

function loadState(mondego){
  //mondego.queue(jobCreator.newRepoSync(mondego,undefined,undefined));
  //mondego.queue(jobCreator.newPipelineSync(mondego,undefined,undefined));
  state.map(job=>{
    mondego.queue(jobCreator[job.constructor](mondego,job.cursor,job.input));
  });
}

function fireConsumer(driver,delay){
  setTimeout(()=>{
    if(emptyReportCount>5){
      console.log("Shutting down driver " + driver.id);
      return;
    }
    let isRetry = false;
    let job = driver.pendingJobs.shift();
    if(!job){
      job = driver.failedJobs.shift();
      isRetry = true;
    }
    if(!job) {
      return fireConsumer(driver,long_delay);
    }
    driver.runningJobs.push(job);
    job.fire(driver).then(
      driverResult=>{
        try{
          job.accept(driver, driverResult);
        } catch(ex){
          console.error("Error accepting data: " + ex);
        } finally {
          driver.runningJobs.splice(driver.runningJobs.indexOf(job),1);
          fireConsumer(driver,no_delay);
        }
      },
      ko=>{
        console.error("Job '" + job.name + "' failed on driver " + driver.id + ": " + ko)
        driver.runningJobs.splice(driver.runningJobs.indexOf(job),1);
        driver.failedJobs.push(job);
        fireConsumer(driver, isRetry ? long_delay : no_delay);
      }
    )},delay);
}

function report(mondego){
  setTimeout(
    ()=>{
      let count = 0;
      mondego.forEachDriver(driver=>{
        count+=driver.pendingJobs.length+driver.runningJobs.length+driver.failedJobs.length;
        console.log("Driver " + driver.id + " has " + driver.pendingJobs.length + " pending, "
         + driver.runningJobs.length + " running and " + driver.failedJobs.length + " failed jobs");
      });
      if(count==0){
        emptyReportCount++;
      }
      if(emptyReportCount>5){
        console.log("Idle for too long... shutting down");
      } else{
        report(mondego);
      }
    },5000);
}
